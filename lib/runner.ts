import fs from "node:fs";
import { REGIONS, batchNumbers, batchOf, capOf, getRegion, type Region } from "@/config/regions";
import {
  DRY_RUN_TIMING,
  PASSES,
  PRICING,
  TIMING,
  maxChargeUsd,
  pricePerPlaceUsd,
  validateConfig,
} from "@/config/scrape.config";
import { apifyScraper } from "./apify";
import { cleanItems, placeIdsFromCsv, toCsv, type Item } from "./clean";
import { dryScraper } from "./dryrun";
import { isKeyError, loadKeys, type ApiKey } from "./keys";
import { writeLog } from "./logger";
import { atomicWrite, csvPath, isDryRun, isFileBusy, rawPath } from "./paths";
import { ApiFailure, TERMINAL_STATUSES, buildActorInput, type KeyBalance, type RunInfo, type Scraper } from "./scraper";
import {
  FINISHED_STATUSES,
  ensurePass,
  loadState,
  saveState,
  type CountyState,
  type KeyRecord,
  type PassState,
  type State,
} from "./state";

const timing = () => (isDryRun() ? DRY_RUN_TIMING : TIMING);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (n: number) => `$${n.toFixed(2)}`;

/** Consecutive failed status checks before a run is given up on. */
const MAX_POLL_FAILURES = 60;
/** How long to wait for a CSV that is open in Excel before failing the county. */
const CSV_BUSY_RETRIES = 12;

type Outcome = "finished" | "no-key";

/** A retryable county failure, with an optional wait set by the server. */
class Retryable extends Error {
  constructor(message: string, public waitSecs?: number) {
    super(message);
  }
}
class KeyProblem extends Error {}
class Fatal extends Error {}

/** Keys are shared by every state, so their live balances are too. */
type BalanceStore = { balances: Record<string, KeyBalance | null>; at: number | null };
const shared = globalThis as unknown as { __countyBalances?: BalanceStore };
const balanceStore = (): BalanceStore => (shared.__countyBalances ??= { balances: {}, at: null });

export class Runner {
  state: State;
  scraper: Scraper = isDryRun() ? dryScraper : apifyScraper;
  sleepUntil: number | null = null;
  sleepLabel = "";
  current: string | null = null;
  /** What the current attempt's run cost, so failed attempts log their real spend. */
  private attemptCost = 0;
  private looping = false;
  private wake: (() => void) | null = null;

  constructor(public readonly region: Region) {
    validateConfig();
    this.state = loadState(region);
    const { job } = this.state;
    if (job.status === "running") {
      job.status = "paused";
      job.pauseRequested = false;
      job.notice = "The server restarted while a batch was running. Click Resume to continue.";
    }
    const pass = ensurePass(region, this.state, job.pass);
    for (const c of Object.values(pass.counties)) {
      if (c.status === "running" && !c.runId) c.status = "pending";
    }
    saveState(region, this.state);
    if (balanceStore().at === null) void this.refreshKeys();
  }

  /** Live limit and usage per key suffix, from the Apify limits endpoint. */
  get balances() {
    return balanceStore().balances;
  }

  get balancesAt() {
    return balanceStore().at;
  }

  private passState(n: number): PassState {
    return ensurePass(this.region, this.state, n);
  }

  private get pass(): PassState {
    return this.passState(this.state.job.pass);
  }

  private save() {
    saveState(this.region, this.state);
  }

  private keyRecord(pass: PassState, suffix: string): KeyRecord {
    pass.keys[suffix] ??= { status: "active", spentUsd: 0 };
    return pass.keys[suffix];
  }

  /** Spend on a key across every pass, used when the limits endpoint is unavailable. */
  private trackedSpend(suffix: string) {
    return Object.values(this.state.passes).reduce((sum, p) => sum + (p.keys[suffix]?.spentUsd ?? 0), 0);
  }

  async refreshKeys() {
    for (const key of loadKeys()) {
      this.balances[key.suffix] = await this.scraper.balance(key);
    }
    balanceStore().at = Date.now();
  }

  remainingFor(suffix: string) {
    const b = this.balances[suffix];
    return b ? b.limitUsd - b.usedUsd : PRICING.keyLimitUsd - this.trackedSpend(suffix);
  }

  // ---- Actions from the UI ------------------------------------------------

  batchRunnable(pass: PassState, batch: number) {
    const numbers = batchNumbers(this.region);
    const i = numbers.indexOf(batch);
    return i === 0 || pass.batchDone[numbers[i - 1]] === true;
  }

  openCounties(pass: PassState, batch: number) {
    return this.region.batches[batch].filter((c) => !FINISHED_STATUSES.includes(pass.counties[c].status));
  }

  isBusy() {
    return this.state.job.status !== "idle";
  }

  /** Every state shares the same keys, so only one state may have a job at a time. */
  private assertNoOtherJob() {
    const other = REGIONS.find((r) => r.slug !== this.region.slug && getRunner(r.slug).isBusy());
    if (other) {
      throw new Error(`${other.name} has a job running or paused. Finish or resume it there first.`);
    }
  }

  runBatch(batch: number) {
    if (this.isBusy()) throw new Error("A job is already running or paused. Resume it or let it finish first.");
    this.assertNoOtherJob();
    const pass = this.passState(this.state.activePass);
    if (!this.region.batches[batch]) throw new Error(`Unknown batch ${batch}`);
    if (!this.batchRunnable(pass, batch)) throw new Error(`Mark batch ${batch - 1} as done first.`);
    const queue = this.openCounties(pass, batch);
    if (queue.length === 0) throw new Error(`Batch ${batch} has nothing left to run.`);
    this.state.job = { status: "running", pass: this.state.activePass, queue, pauseRequested: false };
    this.save();
    this.startLoop();
  }

  /** Retry one county, or re-run it with a new cap. Joins the queue if a job is active. */
  runCounty(county: string, newCap?: number) {
    const passNo = this.isBusy() ? this.state.job.pass : this.state.activePass;
    if (!this.isBusy()) this.assertNoOtherJob();
    const pass = this.passState(passNo);
    const c = pass.counties[county];
    if (!c) throw new Error(`Unknown county ${county}`);
    const batch = batchOf(this.region, county);
    if (!this.batchRunnable(pass, batch)) {
      throw new Error(`Batch ${batch - 1} has to be marked done first.`);
    }
    if (c.status === "running") throw new Error(`${county} is already running.`);
    if (newCap !== undefined) {
      if (!Number.isInteger(newCap) || newCap <= 0) throw new Error("Cap must be a positive whole number.");
      c.capOverride = newCap;
    }
    const { job } = this.state;
    if (this.isBusy()) {
      if (!job.queue.includes(county)) job.queue.push(county);
      this.save();
      return;
    }
    this.state.job = { status: "running", pass: passNo, queue: [county], pauseRequested: false };
    this.save();
    this.startLoop();
  }

  pause() {
    const { job } = this.state;
    if (job.status !== "running") throw new Error("Nothing is running.");
    job.pauseRequested = true;
    this.save();
    this.wake?.(); // Skip the wait between counties. A running county still finishes.
  }

  async resume() {
    const { job } = this.state;
    if (job.status === "idle") throw new Error("Nothing to resume.");
    if (job.status === "paused") {
      job.status = "running";
      job.pauseRequested = false;
      job.notice = undefined;
      // Give every key a fresh chance: credit may have been added, and a key that
      // really is empty gets marked exhausted again on its first attempt.
      for (const rec of Object.values(this.pass.keys)) rec.status = "active";
      this.save();
      await this.refreshKeys();
    } else {
      job.pauseRequested = false;
      this.save();
    }
    this.startLoop();
  }

  setBatchDone(batch: number, done: boolean) {
    const pass = this.passState(this.state.activePass);
    if (done) {
      const open = this.openCounties(pass, batch);
      if (open.length > 0) throw new Error(`Still open: ${open.join(", ")}`);
    }
    pass.batchDone[batch] = done;
    this.save();
  }

  setPass(n: number) {
    if (this.isBusy()) throw new Error("Finish or resume the current job before switching pass.");
    if (!PASSES[n]) throw new Error(`Unknown pass ${n}`);
    this.state.activePass = n;
    this.passState(n);
    this.save();
  }

  // ---- The job loop -------------------------------------------------------

  private startLoop() {
    if (this.looping) return;
    this.looping = true;
    void this.loop()
      .catch((err) => this.pauseJob(`Job stopped on an unexpected error: ${(err as Error).message}`))
      .finally(() => {
        this.looping = false;
        this.current = null;
        this.sleepUntil = null;
      });
  }

  private pauseJob(notice?: string) {
    const { job } = this.state;
    job.status = "paused";
    job.pauseRequested = false;
    job.notice = notice;
    this.save();
  }

  private async loop() {
    const { job } = this.state;
    while (true) {
      if (job.pauseRequested) return this.pauseJob();
      if (job.queue.length === 0) {
        job.status = "idle";
        job.notice = undefined;
        this.save();
        return;
      }

      const next = await this.pickNext();
      if (!next) return; // pickNext already paused the job with a banner.

      this.current = next;
      const outcome = await this.processCounty(next);
      this.current = null;
      if (outcome === "no-key") {
        job.queue = job.queue.filter((c) => c !== next);
        job.queue.push(next); // Try cheaper counties first on the next round.
        this.save();
        continue;
      }
      job.queue = job.queue.filter((c) => c !== next);
      this.save();
      await this.refreshKeys();

      if (job.queue.length > 0 && !job.pauseRequested) {
        const t = timing();
        const secs = t.sleepMinSecs + Math.random() * (t.sleepMaxSecs - t.sleepMinSecs);
        await this.sleep(secs, "Next county in", true);
      }
    }
  }

  private capFor(county: string) {
    return this.pass.counties[county].capOverride ?? capOf(this.region, county);
  }

  private chargeLimit(county: string) {
    return maxChargeUsd(this.capFor(county), PASSES[this.state.job.pass].searchTerms.length);
  }

  private requiredBudget(county: string) {
    return this.chargeLimit(county) + PRICING.keyBufferUsd;
  }

  /** First key, in .env order, that is active and can afford this much. */
  private pickKey(required: number): ApiKey | null {
    for (const key of loadKeys()) {
      if (this.keyRecord(this.pass, key.suffix).status === "exhausted") continue;
      if (this.remainingFor(key.suffix) >= required) return key;
    }
    return null;
  }

  /** The first queued county that can run. Counties too costly for any key wait their turn. */
  private async pickNext(): Promise<string | null> {
    const { job } = this.state;
    await this.refreshKeys();
    for (const county of job.queue) {
      if (this.pass.counties[county].runId) return county; // Reattach, no new spend.
      if (this.pickKey(this.requiredBudget(county))) return county;
    }
    const keys = loadKeys();
    const allExhausted = keys.every((k) => this.keyRecord(this.pass, k.suffix).status === "exhausted");
    if (keys.length === 0 || allExhausted) {
      this.pauseJob("All keys exhausted: add keys to .env and click Resume");
    } else {
      const county = job.queue[0];
      const others = job.queue.length > 1 ? ` or the ${job.queue.length - 1} other queued counties` : "";
      this.pauseJob(
        `No key has enough budget left for ${county} (needs ${money(this.requiredBudget(county))})${others}. Add keys to .env and click Resume.`,
      );
    }
    return null;
  }

  private async sleep(secs: number, label: string, cancelOnPause = false) {
    this.sleepUntil = Date.now() + secs * 1000;
    this.sleepLabel = label;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, secs * 1000);
      if (cancelOnPause) {
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      }
    });
    this.wake = null;
    this.sleepUntil = null;
  }

  private backoffSecs(failures: number) {
    const t = timing();
    const base = t.backoffSecs[Math.min(failures - 1, t.backoffSecs.length - 1)];
    return base * (1 + Math.random() * t.jitter);
  }

  private async processCounty(county: string): Promise<Outcome> {
    const c = this.pass.counties[county];
    const t = timing();
    const passNo = this.state.job.pass;
    let failures = 0;
    let attempt = 0;
    c.status = "running";
    c.error = undefined;
    this.save();

    while (true) {
      attempt++;
      this.attemptCost = 0;
      const started = Date.now();
      const key = c.runId
        ? loadKeys().find((k) => k.suffix === c.runKeySuffix) ?? null
        : this.pickKey(this.requiredBudget(county));
      if (!key) {
        c.status = "pending";
        c.runId = undefined;
        this.save();
        return "no-key";
      }
      const log = (status: string, resultCount: number, costUsd: number, note?: string) =>
        writeLog(this.region.slug, {
          county,
          pass: passNo,
          key: `…${key.suffix}`,
          attempt,
          status,
          durationMs: Date.now() - started,
          resultCount,
          costUsd,
          note,
        });

      try {
        const run = await this.executeRun(county, key);
        const result = await this.collect(county, key, run);
        log(c.status, c.rows, run.costUsd, run.message.slice(0, 200));
        return result;
      } catch (err) {
        const message = (err as Error).message;
        c.runId = undefined;
        c.runKeySuffix = undefined;
        this.save();

        if (err instanceof KeyProblem) {
          this.keyRecord(this.pass, key.suffix).status = "exhausted";
          const b = this.balances[key.suffix];
          this.balances[key.suffix] = { limitUsd: b?.limitUsd ?? PRICING.keyLimitUsd, usedUsd: b?.limitUsd ?? PRICING.keyLimitUsd, resetsAt: b?.resetsAt };
          log("key-exhausted", 0, this.attemptCost, message);
          this.save();
          await this.sleep(t.sleepMinSecs, "Switching key in");
          continue; // Not counted as a failure.
        }

        failures++;
        log("error", 0, this.attemptCost, message);
        if (err instanceof Fatal || failures >= t.maxAttempts) {
          c.status = "failed";
          c.error = message;
          this.save();
          return "finished";
        }
        const wait = err instanceof Retryable && err.waitSecs ? err.waitSecs : this.backoffSecs(failures);
        await this.sleep(wait, `Retrying ${county} in`);
      }
    }
  }

  /** Starts a run, or reattaches to the one saved in state, and waits for it to end. */
  private async executeRun(county: string, key: ApiKey): Promise<RunInfo> {
    const c = this.pass.counties[county];
    const passConfig = PASSES[this.state.job.pass];
    const cap = this.capFor(county);
    if (!c.runId) {
      try {
        c.runId = await this.scraper.start(
          key,
          buildActorInput(passConfig, this.region, county, cap),
          { maxTotalChargeUsd: this.chargeLimit(county), timeoutSecs: timing().runTimeoutSecs },
          county,
        );
      } catch (err) {
        throw this.classify(err);
      }
      c.runKeySuffix = key.suffix;
      this.save();
    }

    const runId = c.runId;
    let pollFailures = 0;
    while (true) {
      try {
        const run = await this.scraper.getRun(key, runId);
        pollFailures = 0;
        if (TERMINAL_STATUSES.includes(run.status)) return this.checkRun(county, key, run);
      } catch (err) {
        if (err instanceof Retryable || err instanceof KeyProblem || err instanceof Fatal) throw err;
        if ((err as ApiFailure).httpStatus === 404) throw new Retryable(`Run ${runId} no longer exists`);
        // A failed status check says nothing about the run, which is still spending.
        // Keep watching it rather than starting a second one.
        if (++pollFailures >= MAX_POLL_FAILURES) {
          await this.scraper.abort(key, runId);
          throw new Retryable(`Lost contact with run ${runId}: ${(err as Error).message}`);
        }
      }
      await delay(timing().pollSecs * 1000);
    }
  }

  private isBudgetStop(run: RunInfo, county: string) {
    const limit = this.chargeLimit(county);
    const nearLimit = run.costUsd >= limit - pricePerPlaceUsd() * 2;
    return nearLimit || /charge limit|total charge|max(imum)? (total )?(charge|cost)/i.test(run.message);
  }

  /** Records the spend, then decides whether this run produced usable data. */
  private checkRun(county: string, key: ApiKey, run: RunInfo): RunInfo {
    const c = this.pass.counties[county];
    this.keyRecord(this.pass, key.suffix).spentUsd += run.costUsd;
    c.costUsd += run.costUsd;
    this.attemptCost = run.costUsd;
    this.save();

    if (run.status === "SUCCEEDED" || this.isBudgetStop(run, county)) return run;
    const message = `Run ${run.status}: ${run.message}`.slice(0, 300);
    if (isKeyError(undefined, run.message)) throw new KeyProblem(message);
    if (run.status === "ABORTED") throw new Fatal(message);
    throw new Retryable(message);
  }

  /** Turns an API error into the retry behaviour it calls for. */
  private classify(err: unknown): Error {
    const e = err as ApiFailure;
    const status = e.httpStatus;
    if (isKeyError(status, e.message)) return new KeyProblem(e.message);
    if (status === undefined || status === 429 || status >= 500) {
      return new Retryable(e.message, status === 429 ? e.retryAfterSecs : undefined);
    }
    return new Fatal(`HTTP ${status}: ${e.message}`);
  }

  private async fetchItems(key: ApiKey, datasetId: string): Promise<Item[]> {
    for (let i = 1; ; i++) {
      try {
        return await this.scraper.items(key, datasetId);
      } catch (err) {
        // The run is already paid for, so try hard rather than running it again.
        if (i >= 5) throw new Fatal(`Could not read results: ${(err as Error).message}`);
        await delay(this.backoffSecs(1) * 1000);
      }
    }
  }

  private previousPassIds(county: string, pass: number): Set<string> {
    if (pass !== 2) return new Set();
    const file = csvPath(this.region.slug, 1, county);
    if (!fs.existsSync(file)) return new Set();
    return placeIdsFromCsv(fs.readFileSync(file, "utf8"));
  }

  private async writeCsv(file: string, csv: string) {
    for (let i = 1; ; i++) {
      try {
        atomicWrite(file, csv);
        return;
      } catch (err) {
        if (!isFileBusy(err)) throw err;
        if (i >= CSV_BUSY_RETRIES) {
          throw new Fatal(`Could not save ${file}. Close it in Excel and retry the county.`);
        }
        await this.sleep(5, "CSV is open elsewhere, retrying in");
      }
    }
  }

  private async collect(county: string, key: ApiKey, run: RunInfo): Promise<Outcome> {
    const c: CountyState = this.pass.counties[county];
    const passNo = this.state.job.pass;
    const items = await this.fetchItems(key, run.datasetId);
    atomicWrite(rawPath(this.region.slug, passNo, county), JSON.stringify(items, null, 2));

    const { kept, dropped } = cleanItems(items, this.region, this.previousPassIds(county, passNo));
    const csv = toCsv(kept, {
      county,
      batch: batchOf(this.region, county),
      pass: passNo,
      scrapedAt: new Date().toISOString(),
    });
    await this.writeCsv(csvPath(this.region.slug, passNo, county), csv);

    const cap = this.capFor(county);
    const terms = PASSES[passNo].searchTerms.length;
    const hitCap = kept.length >= cap || items.length >= cap * terms;
    c.rows = kept.length;
    c.rawRows = items.length;
    c.dropped = dropped;
    c.error = undefined;
    c.runId = undefined;
    c.runKeySuffix = undefined;
    c.finishedAt = new Date().toISOString();
    c.status = this.isBudgetStop(run, county) ? "budget-capped" : hitCap ? "hit-cap" : "done";
    this.save();
    return "finished";
  }
}

// Next.js bundles each route on its own, so the runners have to live on globalThis.
// One runner per state, each with its own data/{state}/ folder.
const holder = globalThis as unknown as { __countyRunners?: Record<string, Runner> };

export function getRunner(slug?: string | null): Runner {
  const region = getRegion(slug);
  holder.__countyRunners ??= {};
  holder.__countyRunners[region.slug] ??= new Runner(region);
  return holder.__countyRunners[region.slug];
}
