export type TierName = "large" | "mid" | "small";

/**
 * One US state to scrape. "Region" in code, "State" in the UI, so it never clashes
 * with the app's saved progress (lib/state.ts).
 */
export type Region = {
  /** Folder name under data/ and the value in ?state= URLs. */
  slug: string;
  /** Full name, used in the actor's locationQuery and to clean rows. */
  name: string;
  /** Postal code, also accepted when cleaning rows. */
  abbr: string;
  /** Exact number of counties. Startup checks the lists below against it. */
  countyCount: number;
  /** Per-county result cap (maxCrawledPlacesPerSearch) by tier. */
  tiers: Record<TierName, { cap: number; counties: string[] }>;
  /** Counties run in this order inside each batch. */
  batches: Record<number, string[]>;
};
