import fs from "node:fs";
import { allCounties, batchNumbers, type Region } from "@/config/regions";
import { ACTIVE_PASS } from "@/config/scrape.config";
import type { Dropped } from "./clean";
import { atomicWrite, stateFile } from "./paths";

export type CountyStatus = "pending" | "running" | "done" | "failed" | "hit-cap" | "budget-capped";

export const FINISHED_STATUSES: CountyStatus[] = ["done", "hit-cap", "budget-capped"];

export type CountyState = {
  status: CountyStatus;
  rows: number;
  rawRows: number;
  costUsd: number;
  error?: string;
  dropped?: Dropped;
  /** Set by "Re-run with higher cap". */
  capOverride?: number;
  /** The Apify run in progress, so a restart reattaches instead of paying twice. */
  runId?: string;
  runKeySuffix?: string;
  finishedAt?: string;
};

export type KeyRecord = { status: "active" | "exhausted"; spentUsd: number };

export type PassState = {
  counties: Record<string, CountyState>;
  batchDone: Record<number, boolean>;
  keys: Record<string, KeyRecord>;
};

export type JobState = {
  status: "idle" | "running" | "paused";
  pass: number;
  /** Counties still to run, in order. */
  queue: string[];
  pauseRequested: boolean;
  notice?: string;
};

export type State = {
  /** Last ACTIVE_PASS read from config, to notice when it is edited. */
  configPass: number;
  activePass: number;
  passes: Record<number, PassState>;
  job: JobState;
};

const newCounty = (): CountyState => ({ status: "pending", rows: 0, rawRows: 0, costUsd: 0 });

export function newPassState(region: Region): PassState {
  return {
    counties: Object.fromEntries(allCounties(region).map((c) => [c, newCounty()])),
    batchDone: Object.fromEntries(batchNumbers(region).map((b) => [b, false])),
    keys: {},
  };
}

export function ensurePass(region: Region, state: State, pass: number): PassState {
  state.passes[pass] ??= newPassState(region);
  const p = state.passes[pass];
  // A county moved between batches in config, or newly listed, still needs a row.
  for (const c of allCounties(region)) p.counties[c] ??= newCounty();
  return p;
}

export function loadState(region: Region): State {
  const file = stateFile(region.slug);
  let state: State;
  if (fs.existsSync(file)) {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as State;
  } else {
    state = {
      configPass: ACTIVE_PASS,
      activePass: ACTIVE_PASS,
      passes: {},
      job: { status: "idle", pass: ACTIVE_PASS, queue: [], pauseRequested: false },
    };
  }
  if (state.configPass !== ACTIVE_PASS) {
    state.configPass = ACTIVE_PASS;
    state.activePass = ACTIVE_PASS;
  }
  ensurePass(region, state, state.activePass);
  return state;
}

export function saveState(region: Region, state: State) {
  atomicWrite(stateFile(region.slug), JSON.stringify(state, null, 2));
}
