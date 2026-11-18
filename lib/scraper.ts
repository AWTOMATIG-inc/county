import type { Region } from "@/config/regions";
import type { PassConfig } from "@/config/scrape.config";
import type { Item } from "./clean";
import type { ApiKey } from "./keys";

export type RunInfo = {
  status: string;
  message: string;
  costUsd: number;
  datasetId: string;
};

export class ApiFailure extends Error {
  constructor(
    message: string,
    /** Missing when the failure is a network error. */
    public httpStatus?: number,
    public retryAfterSecs?: number,
  ) {
    super(message);
  }
}

export type StartOptions = { maxTotalChargeUsd: number; timeoutSecs: number };

export interface Scraper {
  start(key: ApiKey, input: object, opts: StartOptions, county: string): Promise<string>;
  getRun(key: ApiKey, runId: string): Promise<RunInfo>;
  abort(key: ApiKey, runId: string): Promise<void>;
  items(key: ApiKey, datasetId: string): Promise<Item[]>;
  /** This key's monthly limit and usage, or null if that can't be read. */
  balance(key: ApiKey): Promise<KeyBalance | null>;
}

export type KeyBalance = { limitUsd: number; usedUsd: number; resetsAt?: string };

export const TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];

/**
 * Only these fields are sent. Location fields such as city or county conflict with
 * locationQuery, and skipClosedPlaces is a paid filter that cleaning makes unnecessary.
 */
export function buildActorInput(pass: PassConfig, region: Region, county: string, cap: number) {
  return {
    searchStringsArray: pass.searchTerms,
    locationQuery: `${county} County, ${region.name}, USA`,
    maxCrawledPlacesPerSearch: cap,
    language: "en",
    countryCode: "us",
    categoryFilterWords: pass.categoryFilter,
    searchMatching: "all",
    scrapePlaceDetailPage: false,
    scrapeContacts: false,
    scrapeSocialMediaProfiles: {
      facebooks: false,
      instagrams: false,
      youtubes: false,
      tiktoks: false,
      twitters: false,
    },
    maxReviews: 0,
    maxImages: 0,
    maxQuestions: 0,
    scrapeDirectories: false,
    scrapeTableReservationProvider: false,
    includeWebResults: false,
    enableCompetitorAnalysis: false,
  };
}
