import { describe, expect, it } from "vitest";
import {
  REGIONS,
  allCounties,
  capOf,
  getRegion,
  tierOf,
  validateRegion,
  type Region,
} from "@/config/regions";
import { PASSES, maxChargeUsd, pricePerPlaceUsd, slugOf, validateConfig } from "@/config/scrape.config";
import { cleanItems, placeIdsFromCsv, toCsv, CSV_HEADERS } from "@/lib/clean";
import { isKeyError, parseKeys } from "@/lib/keys";
import { buildActorInput } from "@/lib/scraper";

const NY = getRegion("new-york");
const AR = getRegion("arkansas");
const FL = getRegion("florida");

/** [large, mid, small] counts in one batch. */
const sizes = (r: Region, b: number) =>
  (["large", "mid", "small"] as const).map(
    (t) => r.batches[b].filter((c) => r.tiers[t].counties.includes(c)).length,
  );

describe("config", () => {
  it("validates every state", () => {
    expect(() => validateConfig()).not.toThrow();
    expect(REGIONS.map((r) => r.slug)).toEqual(["new-york", "arkansas", "florida"]);
  });

  it("New York keeps its 62 counties and original batch split", () => {
    expect(new Set(allCounties(NY)).size).toBe(62);
    expect(sizes(NY, 1)).toEqual([3, 5, 13]);
    expect(sizes(NY, 2)).toEqual([2, 5, 14]);
    expect(sizes(NY, 3)).toEqual([2, 5, 13]);
  });

  it("Arkansas has 75 counties in three batches of 25", () => {
    expect(new Set(allCounties(AR)).size).toBe(75);
    expect(sizes(AR, 1)).toEqual([1, 4, 20]);
    expect(sizes(AR, 2)).toEqual([1, 4, 20]);
    expect(sizes(AR, 3)).toEqual([1, 3, 21]);
    expect([AR.tiers.large.cap, AR.tiers.mid.cap, AR.tiers.small.cap]).toEqual([200, 100, 60]);
  });

  it("Florida has 67 counties in batches of 23/22/22", () => {
    expect(new Set(allCounties(FL)).size).toBe(67);
    expect(sizes(FL, 1)).toEqual([3, 9, 11]);
    expect(sizes(FL, 2)).toEqual([2, 9, 11]);
    expect(sizes(FL, 3)).toEqual([2, 8, 12]);
    expect([FL.tiers.large.cap, FL.tiers.mid.cap, FL.tiers.small.cap]).toEqual([400, 150, 60]);
    expect(buildActorInput(PASSES[1], FL, "Miami-Dade", 400).locationQuery).toBe(
      "Miami-Dade County, Florida, USA",
    );
  });

  it("catches a county missing from the tiers", () => {
    const broken: Region = { ...AR, tiers: { ...AR.tiers, small: { cap: 60, counties: AR.tiers.small.counties.slice(1) } } };
    expect(() => validateRegion(broken)).toThrow();
  });

  it("looks counties up within their own state", () => {
    expect(tierOf(NY, "Washington")).toBe("small");
    expect(tierOf(AR, "Washington")).toBe("large");
    expect(capOf(AR, "Pulaski")).toBe(200);
  });

  it("makes slugs for multi-word names", () => {
    expect(slugOf("St. Lawrence")).toBe("st-lawrence");
    expect(slugOf("New York")).toBe("new-york");
    expect(slugOf("Hot Spring")).toBe("hot-spring");
    expect(slugOf("Miami-Dade")).toBe("miami-dade");
    expect(slugOf("DeSoto")).toBe("desoto");
    expect(slugOf("St. Johns")).toBe("st-johns");
  });
});

describe("charge limit", () => {
  it("never goes below the actor's $0.50 minimum", () => {
    expect(maxChargeUsd(capOf(NY, "Hamilton"), 1)).toBe(0.5);
    expect(maxChargeUsd(capOf(AR, "Lafayette"), 1)).toBe(0.5);
  });

  it("uses the real price, so a full county fits under its limit", () => {
    expect(pricePerPlaceUsd()).toBeCloseTo(0.005);
    expect(maxChargeUsd(400, 1)).toBe(2.5);
    expect(maxChargeUsd(150, 1)).toBe(0.94);
    expect(maxChargeUsd(150, 2)).toBe(1.88);
  });

  it("gives Arkansas tiers $1.25 / $0.63 / $0.50", () => {
    expect(maxChargeUsd(200, 1)).toBe(1.25);
    expect(maxChargeUsd(100, 1)).toBe(0.63);
    expect(maxChargeUsd(60, 1)).toBe(0.5);
  });
});

describe("actor input", () => {
  const input = buildActorInput(PASSES[1], NY, "St. Lawrence", 60) as Record<string, unknown>;

  it("uses lowercase category values", () => {
    expect(input.categoryFilterWords).toEqual(["janitorial service"]);
    for (const pass of Object.values(PASSES)) {
      for (const value of pass.categoryFilter) expect(value).toBe(value.toLowerCase());
    }
  });

  it("omits fields that conflict or cost extra", () => {
    for (const field of ["startUrls", "placeIds", "customGeolocation", "postalCode", "city", "county", "state", "skipClosedPlaces"]) {
      expect(input).not.toHaveProperty(field);
    }
    expect(input.locationQuery).toBe("St. Lawrence County, New York, USA");
  });

  it("names the right state", () => {
    const ar = buildActorInput(PASSES[1], AR, "St. Francis", 60) as Record<string, unknown>;
    expect(ar.locationQuery).toBe("St. Francis County, Arkansas, USA");
    expect(ar.maxCrawledPlacesPerSearch).toBe(60);
  });
});

describe("keys", () => {
  it("parses named lines in file order and ignores the rest", () => {
    const keys = parseKeys("khalid - apify_api_aaa1111\r\n\r\nDRY_RUN=1\r\nashik - apify_api_bbb2222\n");
    expect(keys.map((k) => [k.name, k.suffix])).toEqual([["khalid", "1111"], ["ashik", "2222"]]);
  });

  it("spots key problems", () => {
    expect(isKeyError(402, "")).toBe(true);
    expect(isKeyError(403, "")).toBe(true);
    expect(isKeyError(undefined, "Monthly usage limit exceeded")).toBe(true);
    expect(isKeyError(undefined, "platform-feature-disabled")).toBe(true);
    expect(isKeyError(500, "Server error")).toBe(false);
    expect(isKeyError(400, "Input is not valid")).toBe(false);
  });
});

describe("cleaning", () => {
  const base = { title: "A", placeId: "p1", state: "New York", countryCode: "US" };

  it("keeps service-area businesses with a blank state", () => {
    const { kept } = cleanItems([{ title: "Hidden", placeId: "p2", state: null, countryCode: null }], NY);
    expect(kept).toHaveLength(1);
  });

  it("drops the right rows and counts why", () => {
    const { kept, dropped } = cleanItems(
      [
        base,
        { ...base },
        { ...base, placeId: "p3", state: "New Jersey" },
        { ...base, placeId: "p4", countryCode: "CA" },
        { ...base, placeId: "p5", permanentlyClosed: true },
        { ...base, placeId: "p6", temporarilyClosed: true },
        { ...base, placeId: "p7" },
      ],
      NY,
      new Set(["p7"]),
    );
    expect(kept.map((i) => i.placeId)).toEqual(["p1"]);
    expect(dropped).toMatchObject({ duplicate: 1, otherState: 1, otherCountry: 1, closed: 2, alreadyInPass1: 1 });
  });

  it("keeps the scraped state by name or code and drops neighbours", () => {
    const { kept, dropped } = cleanItems(
      [
        { title: "A", placeId: "a1", state: "Arkansas", countryCode: "US" },
        { title: "B", placeId: "a2", state: "AR", countryCode: "US" },
        { title: "C", placeId: "a3", state: "Tennessee", countryCode: "US" },
        { title: "D", placeId: "a4", state: "New York", countryCode: "US" },
      ],
      AR,
    );
    expect(kept.map((i) => i.placeId)).toEqual(["a1", "a2"]);
    expect(dropped.otherState).toBe(2);
  });
});

describe("csv", () => {
  const csv = toCsv(
    [{
      title: 'Clean, "Best" Co',
      categoryName: "Janitorial service",
      categories: ["Janitorial service", "Cleaners"],
      phoneUnformatted: "+15550100",
      totalScore: 0,
      placeId: "p1",
    }],
    { county: "Tompkins", batch: 3, pass: 1, scrapedAt: "2026-11-06T00:00:00.000Z" },
  );

  it("starts with a BOM and the exact headers", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split(/\r?\n/)[0]).toBe(CSV_HEADERS.join(","));
  });

  it("quotes values, joins categories and falls back on phone", () => {
    expect(csv).toContain('"Clean, ""Best"" Co"');
    expect(csv).toContain("Janitorial service | Cleaners");
    expect(csv).toContain("+15550100");
  });

  it("round-trips Place IDs for the pass 2 dedupe", () => {
    expect([...placeIdsFromCsv(csv)]).toEqual(["p1"]);
  });
});
