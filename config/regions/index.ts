import { ARKANSAS } from "./arkansas";
import { FLORIDA } from "./florida";
import { NEW_YORK } from "./new-york";
import type { Region, TierName } from "./types";

export type { Region, TierName } from "./types";

/** Every state the app knows. To add one: write a file like arkansas.ts and list it here. */
export const REGIONS: Region[] = [NEW_YORK, ARKANSAS, FLORIDA];

export const DEFAULT_REGION = NEW_YORK.slug;

export function getRegion(slug: string | null | undefined): Region {
  const region = REGIONS.find((r) => r.slug === (slug ?? DEFAULT_REGION));
  if (!region) throw new Error(`Unknown state: ${slug}`);
  return region;
}

export const batchNumbers = (r: Region) =>
  Object.keys(r.batches).map(Number).sort((a, b) => a - b);

export const allCounties = (r: Region): string[] => batchNumbers(r).flatMap((b) => r.batches[b]);

export function tierOf(r: Region, county: string): TierName {
  for (const tier of ["large", "mid", "small"] as const) {
    if (r.tiers[tier].counties.includes(county)) return tier;
  }
  throw new Error(`${r.name}: county has no tier: ${county}`);
}

export function batchOf(r: Region, county: string): number {
  for (const b of batchNumbers(r)) if (r.batches[b].includes(county)) return b;
  throw new Error(`${r.name}: county has no batch: ${county}`);
}

export const capOf = (r: Region, county: string) => r.tiers[tierOf(r, county)].cap;

/** Throws at startup if a state's county lists do not line up. */
export function validateRegion(r: Region): void {
  const all = allCounties(r);
  const n = r.countyCount;
  if (all.length !== n || new Set(all).size !== n) {
    throw new Error(
      `${r.name}: batches must hold exactly ${n} unique counties, found ${all.length} entries and ${new Set(all).size} unique`,
    );
  }
  const tiered = Object.values(r.tiers).flatMap((t) => t.counties);
  if (tiered.length !== n || new Set(tiered).size !== n) {
    throw new Error(`${r.name}: tiers must hold exactly ${n} unique counties, found ${tiered.length}`);
  }
  for (const county of all) tierOf(r, county);
}

export function validateRegions(): void {
  const slugs = REGIONS.map((r) => r.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error("Two states share a slug");
  for (const r of REGIONS) validateRegion(r);
}
