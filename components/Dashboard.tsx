"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type County = {
  name: string;
  slug: string;
  tier: string;
  cap: number;
  chargeLimitUsd: number;
  status: string;
  rows: number;
  rawRows: number;
  costUsd: number;
  error?: string;
  hasCsv: boolean;
};

type Batch = {
  n: number;
  counties: County[];
  open: string[];
  done: boolean;
  runnable: boolean;
  complete: boolean;
};

type RegionSummary = {
  slug: string;
  name: string;
  abbr: string;
  countyCount: number;
  finished: number;
  rows: number;
  jobStatus: "idle" | "running" | "paused";
};

type Status = {
  dryRun: boolean;
  region: {
    slug: string;
    name: string;
    abbr: string;
    countyCount: number;
    tiers: Record<string, { cap: number; count: number }>;
  };
  regions: RegionSummary[];
  pass: { n: number; name: string; searchTerms: string[]; categoryFilter: string[] };
  passes: { n: number; name: string }[];
  batches: Batch[];
  keys: {
    name: string;
    suffix: string;
    status: string;
    spentUsd: number;
    remainingUsd: number;
    limitUsd: number | null;
    usedUsd: number | null;
    resetsAt: string | null;
  }[];
  account: {
    usedUsd: number;
    leftUsd: number;
    limitUsd: number;
    keysRead: number;
    keysTotal: number;
    checkedAt: number | null;
  };
  job: {
    status: "idle" | "running" | "paused";
    queue: string[];
    pauseRequested: boolean;
    notice?: string;
    current: string | null;
    sleepUntil: number | null;
    sleepLabel: string;
  };
  totals: { spendUsd: number; rows: number };
  logs: {
    ts: string;
    county: string;
    pass: number;
    key: string;
    attempt: number;
    status: string;
    durationMs: number;
    resultCount: number;
    costUsd: number;
    note?: string;
  }[];
};

const money = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 ? 4 : 2)}`;

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-stone-100 text-stone-500",
  running: "bg-blue-100 text-blue-800",
  done: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  "hit-cap": "bg-amber-100 text-amber-900",
  "budget-capped": "bg-orange-100 text-orange-900",
};

const BUTTON =
  "rounded border border-stone-300 bg-white px-2.5 py-1 text-sm font-medium hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY =
  "rounded bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-30";

export function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  const regionRef = useRef<string | null>(null);

  // The chosen state comes from ?state= first, then the last one viewed.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("county-state");
    } catch {}
    const initial = new URLSearchParams(window.location.search).get("state") ?? saved ?? "new-york";
    regionRef.current = initial;
    setRegion(initial);
  }, []);

  const chooseRegion = (slug: string) => {
    regionRef.current = slug;
    setRegion(slug);
    setStatus(null);
    setError(null);
    try {
      localStorage.setItem("county-state", slug);
    } catch {}
    const url = new URL(window.location.href);
    url.searchParams.set("state", slug);
    window.history.replaceState(null, "", url);
  };

  const refresh = useCallback(async () => {
    const slug = regionRef.current;
    if (!slug) return;
    try {
      const res = await fetch(`/api/status?state=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        // An unknown state in the URL or storage: fall back to the default.
        if (slug !== "new-york") chooseRegion("new-york");
        return;
      }
      // Ignore a slow reply for a state the user has already switched away from.
      if (regionRef.current === slug) setStatus(body);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(refresh, 2000);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh, region]);

  const act = useCallback(
    async (body: object) => {
      setError(null);
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, state: regionRef.current }),
      });
      if (!res.ok) setError((await res.json()).error ?? "Action failed");
      await refresh();
    },
    [refresh],
  );

  if (!status) return <main className="p-6 text-sm text-stone-500">Loading…</main>;

  const { job, pass, totals, account } = status;
  const refreshKeys = async () => {
    setRefreshing(true);
    await act({ type: "refresh-keys" });
    setRefreshing(false);
  };
  const countdown = job.sleepUntil ? Math.max(0, Math.ceil((job.sleepUntil - now) / 1000)) : null;
  const here = status.region;
  const busyElsewhere = status.regions.find((r) => r.slug !== here.slug && r.jobStatus !== "idle");
  const q = `state=${here.slug}`;

  return (
    <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-semibold">County Scraper</h1>
        <label className="flex items-center gap-1.5 text-sm">
          State
          <select
            className="rounded border border-stone-300 bg-white px-1.5 py-1 font-medium"
            value={here.slug}
            onChange={(e) => chooseRegion(e.target.value)}
          >
            {status.regions.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.name} · {r.finished}/{r.countyCount} counties · {r.rows.toLocaleString()} rows
                {r.jobStatus !== "idle" ? ` · ${r.jobStatus}` : ""}
              </option>
            ))}
          </select>
        </label>
        {status.dryRun && (
          <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
            DRY RUN: fake data, no credits used
          </span>
        )}
        <label className="flex items-center gap-1.5 text-sm">
          Pass
          <select
            className="rounded border border-stone-300 bg-white px-1.5 py-1 disabled:opacity-50"
            value={pass.n}
            disabled={job.status !== "idle"}
            onChange={(e) => act({ type: "set-pass", pass: Number(e.target.value) })}
          >
            {status.passes.map((p) => (
              <option key={p.n} value={p.n}>
                {p.n}: {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            className={BUTTON}
            disabled={job.status !== "running" || job.pauseRequested}
            onClick={() => act({ type: "pause" })}
          >
            {job.pauseRequested ? "Pausing after this county…" : "Pause"}
          </button>
          <button
            className={BUTTON}
            disabled={job.status !== "paused" && !job.pauseRequested}
            onClick={() => act({ type: "resume" })}
          >
            Resume
          </button>
          <a className={BUTTON} href={`/api/download-all?${q}&pass=${pass.n}`}>
            Download all
          </a>
        </div>
      </header>

      {offline && <Banner tone="red">Can&apos;t reach the server. Is npm run dev still running?</Banner>}
      {job.notice && <Banner tone="red">{job.notice}</Banner>}
      {busyElsewhere && (
        <Banner tone="amber">
          {busyElsewhere.name} has a {busyElsewhere.jobStatus} job. States share the same keys, so{" "}
          {here.name} can&apos;t start until that job finishes.{" "}
          <button className="underline" onClick={() => chooseRegion(busyElsewhere.slug)}>
            Go to {busyElsewhere.name}
          </button>
        </Banner>
      )}
      {error && <Banner tone="amber">{error}</Banner>}

      <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1.4fr]">
        <Card title="Totals">
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Stat label="Rows" value={totals.rows.toLocaleString()} />
            <Stat label="Estimated spend (this pass)" value={money(totals.spendUsd)} />
            <Stat
              label="Apify spent this month"
              value={account.keysRead > 0 ? `${money(account.usedUsd)} of ${money(account.limitUsd)}` : "Unknown"}
            />
            <Stat label="State / pass" value={`${here.name}, pass ${pass.n}: ${pass.name}`} />
            <Stat label="Job" value={jobLine(status, countdown)} />
            <div>
              <dt className="text-xs text-stone-500">Left on all keys</dt>
              <dd className="font-medium text-emerald-700">
                {account.keysRead > 0 ? money(account.leftUsd) : "Unknown"}
              </dd>
            </div>
          </dl>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
            {account.keysRead < account.keysTotal && (
              <span className="text-amber-700">
                Only {account.keysRead} of {account.keysTotal} keys answered.
              </span>
            )}
            <span>
              Live from Apify
              {account.checkedAt ? `, checked ${new Date(account.checkedAt).toLocaleTimeString()}` : ""}.
            </span>
            <button className={BUTTON} disabled={refreshing} onClick={refreshKeys}>
              {refreshing ? "Checking…" : "Refresh balances"}
            </button>
          </p>
        </Card>
        <Card title="Search and caps">
          <p className="text-sm">
            Searches for <b>{pass.searchTerms.join(", ")}</b> in each {here.name} county, keeping category{" "}
            <b>{pass.categoryFilter.join(", ")}</b>.
          </p>
          <p className="mt-1.5 text-sm">
            Result cap per county:{" "}
            {(["large", "mid", "small"] as const)
              .filter((t) => here.tiers[t])
              .map((t) => `${t} ${here.tiers[t].cap} (${here.tiers[t].count})`)
              .join(" · ")}
          </p>
          <p className="mt-1.5 text-xs text-stone-500">
            A strict &quot;janitorial service&quot; filter drops businesses that Google labels only
            &quot;Cleaning service&quot; or &quot;Commercial cleaning service&quot;. That is expected and is
            why pass 2 exists.
          </p>
        </Card>
        <Card title="Keys, in .env order">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="font-normal">Name</th>
                <th className="font-normal">Key</th>
                <th className="font-normal">Status</th>
                <th className="text-right font-normal">Used / month</th>
                <th className="text-right font-normal">Left</th>
                <th className="text-right font-normal">Resets</th>
              </tr>
            </thead>
            <tbody>
              {status.keys.map((k) => (
                <tr key={k.suffix}>
                  <td>{k.name}</td>
                  <td className="font-mono text-xs">…{k.suffix}</td>
                  <td className={k.status === "exhausted" ? "text-red-700" : "text-emerald-700"}>{k.status}</td>
                  <td className="text-right">
                    {k.usedUsd !== null && k.limitUsd !== null ? `${money(k.usedUsd)} / ${money(k.limitUsd)}` : "?"}
                  </td>
                  <td className="text-right font-medium">{money(k.remainingUsd)}</td>
                  <td className="text-right text-xs text-stone-500">
                    {k.resetsAt
                      ? new Date(k.resetsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        {status.batches.map((b, i) => (
          <BatchPanel
            key={b.n}
            batch={b}
            pass={pass.n}
            q={q}
            jobIdle={job.status === "idle" && !busyElsewhere}
            previous={status.batches[i - 1]?.n}
            act={act}
          />
        ))}
      </section>

      <Card title="Last 50 attempts">
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left text-stone-500">
              <tr>
                {["Time", "County", "Pass", "Key", "Try", "Status", "Secs", "Rows", "Cost", "Note"].map((h) => (
                  <th key={h} className="pr-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {status.logs.map((l, i) => (
                <tr key={`${l.ts}-${i}`} className="align-top">
                  <td className="pr-3 whitespace-nowrap">{new Date(l.ts).toLocaleTimeString()}</td>
                  <td className="pr-3 whitespace-nowrap">{l.county}</td>
                  <td className="pr-3">{l.pass}</td>
                  <td className="pr-3">{l.key}</td>
                  <td className="pr-3">{l.attempt}</td>
                  <td className="pr-3 whitespace-nowrap">{l.status}</td>
                  <td className="pr-3">{Math.round(l.durationMs / 1000)}</td>
                  <td className="pr-3">{l.resultCount}</td>
                  <td className="pr-3">{money(l.costUsd)}</td>
                  <td className="max-w-sm truncate text-stone-500" title={l.note}>
                    {l.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {status.logs.length === 0 && <p className="text-sm text-stone-500">Nothing has run yet.</p>}
        </div>
      </Card>
    </main>
  );
}

function jobLine(status: Status, countdown: number | null) {
  const { job } = status;
  if (countdown !== null) return `${job.sleepLabel} ${countdown}s`;
  if (job.current) return `Running ${job.current}`;
  if (job.status === "paused") return `Paused, ${job.queue.length} left`;
  return job.status === "running" ? "Starting…" : "Idle";
}

function BatchPanel({
  batch,
  pass,
  q,
  jobIdle,
  previous,
  act,
}: {
  batch: Batch;
  pass: number;
  q: string;
  jobIdle: boolean;
  previous?: number;
  act: (body: object) => Promise<void>;
}) {
  const finished = batch.counties.length - batch.open.length;
  const worstCase = batch.counties.reduce((sum, c) => sum + c.chargeLimitUsd, 0);
  const totalRows = batch.counties.reduce((sum, c) => sum + c.rows, 0);
  const totalCost = batch.counties.reduce((sum, c) => sum + c.costUsd, 0);
  const hasAnyCsv = batch.counties.some((c) => c.hasCsv);

  return (
    <div className="rounded border border-stone-200 bg-white p-3">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Batch {batch.n}</h2>
        <span className="text-xs text-stone-500">
          {finished}/{batch.counties.length} finished · limit total {money(worstCase)}
        </span>
        {hasAnyCsv ? (
          <a className={`${BUTTON} ml-auto`} href={`/api/download-all?${q}&pass=${pass}&batch=${batch.n}`}>
            Download zip
          </a>
        ) : (
          <span className="ml-auto" />
        )}
        <button
          className={PRIMARY}
          disabled={!batch.runnable || !jobIdle || batch.complete}
          onClick={() => act({ type: "run-batch", batch: batch.n })}
        >
          Run batch {batch.n}
        </button>
      </div>

      {!batch.runnable && (
        <p className="mt-1 text-xs text-stone-500">Locked until batch {previous} is marked done.</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 rounded bg-stone-50 px-2 py-1.5 text-sm">
        <span>{batch.complete && !batch.done ? <b>Batch complete. Mark as done?</b> : "Batch done?"}</span>
        <button
          className={`${BUTTON} ${batch.done ? "border-emerald-600 bg-emerald-50" : ""}`}
          disabled={!batch.complete}
          onClick={() => act({ type: "batch-done", batch: batch.n, done: true })}
        >
          Yes
        </button>
        <button
          className={`${BUTTON} ${batch.done ? "" : "border-stone-500"}`}
          onClick={() => act({ type: "batch-done", batch: batch.n, done: false })}
        >
          No
        </button>
        {!batch.complete && batch.runnable && finished > 0 && (
          <span className="w-full text-xs text-stone-500">Still open: {batch.open.join(", ")}</span>
        )}
      </div>

      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-stone-500">
          <tr>
            <th className="font-normal">County</th>
            <th className="font-normal">Status</th>
            <th className="text-right font-normal">Rows</th>
            <th className="text-right font-normal">Cost</th>
            <th className="text-right font-normal">CSV</th>
          </tr>
        </thead>
        <tbody>
          {batch.counties.map((c) => (
            <CountyRow key={c.name} county={c} pass={pass} q={q} locked={!batch.runnable} act={act} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-stone-300 font-semibold">
            <td className="py-1.5">Total</td>
            <td />
            <td className="text-right">{totalRows.toLocaleString()}</td>
            <td className="text-right text-xs">{totalCost > 0 ? money(totalCost) : ""}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CountyRow({
  county: c,
  pass,
  q,
  locked,
  act,
}: {
  county: County;
  pass: number;
  q: string;
  locked: boolean;
  act: (body: object) => Promise<void>;
}) {
  const [cap, setCap] = useState(String(c.cap * 2));
  const showRetry = c.status === "failed";
  // A budget stop needs a higher cap too: the run's charge limit is worked out from the cap.
  const showCap = c.status === "hit-cap" || c.status === "budget-capped";

  return (
    <>
      <tr className="border-t border-stone-100">
        <td className="py-1">
          {c.name} <span className="text-xs text-stone-400">{c.cap}</span>
        </td>
        <td>
          <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLES[c.status]}`}>{c.status}</span>
        </td>
        <td className="text-right">{c.status === "pending" ? "" : c.rows}</td>
        <td className="text-right text-xs text-stone-500">{c.costUsd > 0 ? money(c.costUsd) : ""}</td>
        <td className="text-right">
          {c.hasCsv && (
            <a className="text-blue-700 underline" href={`/api/download?${q}&pass=${pass}&county=${c.slug}`}>
              CSV
            </a>
          )}
        </td>
      </tr>
      {(showRetry || showCap) && (
        <tr>
          <td colSpan={5} className="pb-2 text-xs">
            {c.error && <p className="mb-1 break-words text-red-700">{c.error}</p>}
            {showCap && (
              <span className="flex flex-wrap items-center gap-1.5">
                <input
                  aria-label={`New cap for ${c.name}`}
                  className="w-20 rounded border border-stone-300 px-1.5 py-0.5"
                  type="number"
                  min={1}
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                />
                <button
                  className={BUTTON}
                  disabled={locked}
                  onClick={() => act({ type: "run-county", county: c.name, cap: Number(cap) })}
                >
                  Re-run with higher cap
                </button>
              </span>
            )}
            {showRetry && (
              <button className={BUTTON} disabled={locked} onClick={() => act({ type: "run-county", county: c.name })}>
                Retry {c.name}
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-3">
      <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Banner({ tone, children }: { tone: "red" | "amber"; children: React.ReactNode }) {
  const style = tone === "red" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900";
  return <div className={`rounded border px-3 py-2 text-sm font-medium ${style}`}>{children}</div>;
}
