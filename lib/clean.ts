import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

// Actor items have dozens of loosely typed fields; only the ones used below matter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>;

export type Dropped = {
  otherState: number;
  otherCountry: number;
  closed: number;
  duplicate: number;
  alreadyInPass1: number;
  noTitle: number;
};

export const CSV_HEADERS = [
  "Company Name", "Category Name", "All Categories", "Address", "Street", "City", "State", "Zip",
  "Phone", "Website", "Rating", "Review Count", "Google Maps URL", "Place ID", "Target County",
  "Batch", "Pass", "Scraped At",
];

const blank = (v: unknown) => v === null || v === undefined || v === "";

/** The state being scraped, by full name or postal code. */
export type HomeState = { name: string; abbr: string };

function isHome(state: string, home: HomeState) {
  const s = state.trim().toLowerCase();
  return s === home.name.toLowerCase() || s === home.abbr.toLowerCase();
}

/**
 * Service-area businesses hide their address, so state and countryCode come back
 * null. They stay in: the actor already limits results to the county by coordinates.
 * Only a filled-in value that is wrong gets a row dropped.
 */
export function cleanItems(items: Item[], home: HomeState, excludePlaceIds: Set<string> = new Set()) {
  const dropped: Dropped = {
    otherState: 0, otherCountry: 0, closed: 0, duplicate: 0, alreadyInPass1: 0, noTitle: 0,
  };
  const seen = new Set<string>();
  const kept: Item[] = [];
  for (const item of items) {
    if (blank(item.title)) dropped.noTitle++;
    else if (!blank(item.state) && !isHome(String(item.state), home)) dropped.otherState++;
    else if (!blank(item.countryCode) && String(item.countryCode).toUpperCase() !== "US") dropped.otherCountry++;
    else if (item.permanentlyClosed === true || item.temporarilyClosed === true) dropped.closed++;
    else if (item.placeId && seen.has(item.placeId)) dropped.duplicate++;
    else if (item.placeId && excludePlaceIds.has(item.placeId)) dropped.alreadyInPass1++;
    else {
      if (item.placeId) seen.add(item.placeId);
      kept.push(item);
    }
  }
  return { kept, dropped };
}

export function toCsv(
  items: Item[],
  ctx: { county: string; batch: number; pass: number; scrapedAt: string },
): string {
  const rows = items.map((i) =>
    [
      i.title,
      i.categoryName,
      Array.isArray(i.categories) ? i.categories.join(" | ") : "",
      i.address,
      i.street,
      i.city,
      i.state,
      i.postalCode,
      i.phone || i.phoneUnformatted,
      i.website,
      i.totalScore,
      i.reviewsCount,
      i.url,
      i.placeId,
      ctx.county,
      ctx.batch,
      ctx.pass,
      i.scrapedAt || ctx.scrapedAt,
    ].map((v) => v ?? ""),
  );
  return stringify(rows, { bom: true, header: true, columns: CSV_HEADERS });
}

/** Reads the Place ID column from an earlier pass's CSV. */
export function placeIdsFromCsv(csv: string): Set<string> {
  const rows = parse(csv, { bom: true, columns: true, skip_empty_lines: true }) as Record<string, string>[];
  return new Set(rows.map((r) => r["Place ID"]).filter(Boolean));
}
