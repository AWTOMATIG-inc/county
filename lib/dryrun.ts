import { pricePerPlaceUsd } from "@/config/scrape.config";
import type { Item } from "./clean";
import type { ApiKey } from "./keys";
import { ApiFailure, type RunInfo, type Scraper, type StartOptions } from "./scraper";

/**
 * Fake actor for DRY_RUN=1. It sends nothing to Apify. Some counties are scripted
 * so every UI state and failure path shows up during a test:
 *   Nassau hits its cap, Ulster stops on budget, Cayuga fails twice then works,
 *   Chemung fails all 3 attempts then works on a manual retry, Clinton's first key
 *   is out of credit, Essex gets a 429, Columbia a network error, Allegany a timeout.
 */
type FakeRun = { status: string; message: string; costUsd: number; rows: Item[] };

const runs = new Map<string, FakeRun>();
const attemptsByCounty = new Map<string, number>();
const spentByKey = new Map<string, number>();
let nextId = 1;

const budget = () => Number(process.env.DRY_KEY_LIMIT_USD ?? 5);

function fakeItems(county: string, count: number, stateName: string): Item[] {
  const id = `${stateName}-${county}`.replace(/\W/g, "");
  const items: Item[] = [];
  for (let i = 1; i <= count; i++) {
    const hidden = i % 5 === 0; // service-area business with no address
    items.push({
      title: `${county} Janitorial Co ${i}`,
      categoryName: i % 4 === 0 ? "Commercial cleaning service" : "Janitorial service",
      categories: ["Janitorial service", "Cleaners"],
      address: hidden ? null : `${i} Main St, ${county}, ${stateName} 10001`,
      street: hidden ? null : `${i} Main St`,
      city: hidden ? null : county,
      state: hidden ? null : stateName,
      countryCode: hidden ? null : "US",
      postalCode: hidden ? null : "10001",
      phone: `(555) 010-${String(i).padStart(4, "0")}`,
      website: `https://example.com/${i}`,
      totalScore: 4.2,
      reviewsCount: i * 3,
      url: `https://www.google.com/maps/place/?q=place_id:dry-${id}-${i}`,
      placeId: `dry-${id}-${i}`,
      permanentlyClosed: false,
      temporarilyClosed: false,
    });
  }
  // Rows the cleaning step has to remove.
  items.push({ ...items[0] });
  items.push({ ...items[0], placeId: `dry-${id}-nj`, state: "New Jersey" });
  items.push({ ...items[0], placeId: `dry-${id}-closed`, permanentlyClosed: true });
  return items;
}

export const dryScraper: Scraper = {
  async start(key: ApiKey, input: object, opts: StartOptions, realCounty: string) {
    const { maxCrawledPlacesPerSearch: cap, locationQuery } = input as {
      maxCrawledPlacesPerSearch: number;
      locationQuery: string;
    };
    // "Pulaski County, Arkansas, USA" → "Arkansas". Fake rows carry it so cleaning keeps them.
    const stateName = locationQuery.split(", ")[1];
    const attemptKey = `${stateName}/${realCounty}`;
    const attempt = (attemptsByCounty.get(attemptKey) ?? 0) + 1;
    attemptsByCounty.set(attemptKey, attempt);
    // The scripted failures below are New York counties. Other states only get clean runs.
    const county = stateName === "New York" ? realCounty : `${stateName}/${realCounty}`;

    if (county === "Essex" && attempt === 1) throw new ApiFailure("Rate limit exceeded", 429, 2);
    if (county === "Clinton" && attempt === 1) throw new ApiFailure("Monthly usage limit exceeded", 402);
    if (county === "Columbia" && attempt === 1) throw new ApiFailure("Network error: socket hang up");

    let run: FakeRun;
    if ((county === "Cayuga" && attempt <= 2) || (county === "Chemung" && attempt <= 3)) {
      run = { status: "FAILED", message: "Fake actor crash", costUsd: 0.01, rows: [] };
    } else if (county === "Allegany" && attempt === 1) {
      run = { status: "TIMED-OUT", message: "Fake timeout", costUsd: 0.02, rows: [] };
    } else if (county === "Nassau" && cap === 400) {
      run = {
        status: "SUCCEEDED",
        message: "Scraping finished",
        costUsd: cap * pricePerPlaceUsd(),
        rows: fakeItems(realCounty, cap, stateName),
      };
    } else if (county === "Ulster") {
      run = {
        status: "SUCCEEDED",
        message: "Stopped: maximum total charge reached",
        costUsd: opts.maxTotalChargeUsd,
        rows: fakeItems(realCounty, 40, stateName),
      };
    } else {
      const count = 3 + ((realCounty.length * 7) % 25);
      run = {
        status: "SUCCEEDED",
        message: "Scraping finished",
        costUsd: count * pricePerPlaceUsd(),
        rows: fakeItems(realCounty, count, stateName),
      };
    }
    spentByKey.set(key.suffix, (spentByKey.get(key.suffix) ?? 0) + run.costUsd);
    const id = `dry-${nextId++}`;
    runs.set(id, run);
    return id;
  },

  async getRun(_key, runId): Promise<RunInfo> {
    await new Promise((r) => setTimeout(r, 300));
    const run = runs.get(runId);
    if (!run) throw new ApiFailure(`Run ${runId} not found`, 404);
    return { status: run.status, message: run.message, costUsd: run.costUsd, datasetId: runId };
  },

  async abort() {},

  async items(_key, datasetId) {
    return runs.get(datasetId)?.rows ?? [];
  },

  async balance(key) {
    return { limitUsd: budget(), usedUsd: spentByKey.get(key.suffix) ?? 0 };
  },
};
