// Everything you are likely to want to edit lives in this file, except the states
// (counties, tiers, batches), which live in config/regions/.
import { validateRegions } from "./regions";

export type PassConfig = {
  name: string;
  searchTerms: string[];
  /**
   * Actor filter values. They MUST be lowercase and from the actor's own list,
   * otherwise Apify rejects the run with "Input is not valid".
   * A place matches if ANY of its categories contains all the words of a value.
   */
  categoryFilter: string[];
};

export const PASSES: Record<number, PassConfig> = {
  1: {
    name: "janitorial",
    searchTerms: ["janitorial service"],
    categoryFilter: ["janitorial service"],
  },
  2: {
    name: "commercial-cleaning",
    searchTerms: ["commercial cleaning service", "office cleaning service"],
    // Kept to janitorial on purpose. "cleaning service" is valid but also pulls
    // in house, carpet, window and pool cleaners.
    categoryFilter: ["janitorial service"],
  },
};

export const ACTIVE_PASS = 1;

export const ACTOR_ID = "compass/crawler-google-places";

export const PRICING = {
  /** Apify free-plan price per place. */
  placeUsd: 0.004,
  /** Added per place for each paid filter. categoryFilterWords is one flat filter. */
  filterUsd: 0.001,
  /** Paid filters sent to the actor. Do not add skipClosedPlaces: cleaning already handles it. */
  paidFilters: 1,
  /** Margin on top of the expected cost for each run's charge limit. */
  safetyMultiplier: 1.25,
  /** The actor refuses any run with a charge limit below this. */
  minRunChargeUsd: 0.5,
  /** A key must keep this much on top of the run's charge limit. */
  keyBufferUsd: 0.25,
  /** Used only when the Apify limits endpoint cannot be reached. */
  keyLimitUsd: 5,
};

export const TIMING = {
  sleepMinSecs: 5,
  sleepMaxSecs: 10,
  /** Delay before attempts 2, 3 and so on. */
  backoffSecs: [30, 90, 270],
  /** Up to this fraction is added to each backoff. */
  jitter: 0.25,
  maxAttempts: 3,
  /** Hard stop for one actor run. */
  runTimeoutSecs: 3600,
  pollSecs: 5,
};

export const DRY_RUN_TIMING = {
  sleepMinSecs: 1,
  sleepMaxSecs: 2,
  backoffSecs: [1, 2, 3],
  jitter: 0.25,
  maxAttempts: 3,
  runTimeoutSecs: 60,
  pollSecs: 1,
};

// Counties, tiers and batches live per state in config/regions/.

export function slugOf(county: string): string {
  return county.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function pricePerPlaceUsd(): number {
  return PRICING.placeUsd + PRICING.filterUsd * PRICING.paidFilters;
}

/** The charge limit for one county run, rounded up to a whole cent. */
export function maxChargeUsd(cap: number, searchTerms: number): number {
  const expected = cap * pricePerPlaceUsd() * PRICING.safetyMultiplier * searchTerms;
  const limit = Math.max(PRICING.minRunChargeUsd, expected);
  return Math.ceil(Number((limit * 100).toFixed(6))) / 100;
}

/** Throws at startup if any state's county lists do not line up. */
export function validateConfig(): void {
  validateRegions();
  if (!PASSES[ACTIVE_PASS]) throw new Error(`ACTIVE_PASS ${ACTIVE_PASS} is not defined in PASSES`);
}
