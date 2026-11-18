import fs from "node:fs";
import { NextResponse } from "next/server";
import { REGIONS, batchNumbers, capOf, tierOf } from "@/config/regions";
import { PASSES, maxChargeUsd, slugOf } from "@/config/scrape.config";
import { loadKeys } from "@/lib/keys";
import { tailLog } from "@/lib/logger";
import { csvPath, isDryRun } from "@/lib/paths";
import { getRunner } from "@/lib/runner";
import { FINISHED_STATUSES, ensurePass } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("state");
  const region = REGIONS.find((r) => r.slug === (slug ?? "new-york"));
  if (!region) return NextResponse.json({ error: `Unknown state ${slug}` }, { status: 404 });
  const runner = getRunner(region.slug);
  const { state } = runner;
  const passNo = state.job.status === "idle" ? state.activePass : state.job.pass;
  const pass = ensurePass(region, state, passNo);
  const terms = PASSES[passNo].searchTerms.length;

  const batches = batchNumbers(region).map((n) => {
    const counties = region.batches[n].map((name) => {
      const c = pass.counties[name];
      const cap = c.capOverride ?? capOf(region, name);
      return {
        name,
        slug: slugOf(name),
        tier: tierOf(region, name),
        cap,
        chargeLimitUsd: maxChargeUsd(cap, terms),
        status: c.status,
        rows: c.rows,
        rawRows: c.rawRows,
        costUsd: c.costUsd,
        error: c.error,
        hasCsv: fs.existsSync(csvPath(region.slug, passNo, name)),
      };
    });
    const open = runner.openCounties(pass, n);
    return {
      n,
      counties,
      open,
      done: pass.batchDone[n] === true,
      runnable: runner.batchRunnable(pass, n),
      complete: open.length === 0,
    };
  });

  // Never add the token to this response: it goes straight to the browser.
  const keys = loadKeys().map((k) => {
    const b = runner.balances[k.suffix];
    return {
      name: k.name,
      suffix: k.suffix,
      status: pass.keys[k.suffix]?.status ?? "active",
      spentUsd: pass.keys[k.suffix]?.spentUsd ?? 0,
      remainingUsd: runner.remainingFor(k.suffix),
      limitUsd: b?.limitUsd ?? null,
      usedUsd: b?.usedUsd ?? null,
      resetsAt: b?.resetsAt ?? null,
    };
  });
  const live = keys.filter((k) => k.limitUsd !== null);

  const counties = Object.values(pass.counties);

  // A short summary of every state for the dropdown, plus whether it has a job,
  // since only one state may run at a time.
  const regions = REGIONS.map((r) => {
    const rs = getRunner(r.slug).state;
    const p = ensurePass(r, rs, rs.activePass);
    const all = Object.values(p.counties);
    return {
      slug: r.slug,
      name: r.name,
      abbr: r.abbr,
      countyCount: r.countyCount,
      finished: all.filter((c) => FINISHED_STATUSES.includes(c.status)).length,
      rows: all.reduce((sum, c) => sum + c.rows, 0),
      jobStatus: rs.job.status,
    };
  });

  return NextResponse.json({
    dryRun: isDryRun(),
    region: {
      slug: region.slug,
      name: region.name,
      abbr: region.abbr,
      countyCount: region.countyCount,
      tiers: Object.fromEntries(
        Object.entries(region.tiers).map(([t, v]) => [t, { cap: v.cap, count: v.counties.length }]),
      ),
    },
    regions,
    pass: { n: passNo, ...PASSES[passNo] },
    passes: Object.entries(PASSES).map(([n, p]) => ({ n: Number(n), name: p.name })),
    batches,
    keys,
    job: {
      status: state.job.status,
      queue: state.job.queue,
      pauseRequested: state.job.pauseRequested,
      notice: state.job.notice,
      current: runner.current,
      sleepUntil: runner.sleepUntil,
      sleepLabel: runner.sleepLabel,
    },
    totals: {
      spendUsd: counties.reduce((s, c) => s + c.costUsd, 0),
      rows: counties.reduce((s, c) => s + c.rows, 0),
    },
    // Live Apify numbers for the current monthly cycle, summed over keys that answered.
    account: {
      usedUsd: live.reduce((s, k) => s + (k.usedUsd ?? 0), 0),
      leftUsd: live.reduce((s, k) => s + k.remainingUsd, 0),
      limitUsd: live.reduce((s, k) => s + (k.limitUsd ?? 0), 0),
      keysRead: live.length,
      keysTotal: keys.length,
      checkedAt: runner.balancesAt,
    },
    logs: tailLog(region.slug, 50).reverse(),
  });
}
