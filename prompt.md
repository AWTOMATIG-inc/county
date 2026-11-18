# Task: Build a Next.js app that scrapes janitorial companies for all 62 New York counties via Apify

Build a small local Next.js app (App Router, TypeScript, no database) that runs an Apify Google Maps actor county by county, in 3 batches, and saves one CSV per county. It runs locally with `npm run dev`; do not design it for serverless hosting.

The scrape is organized into **passes**. Pass 1 targets janitorial companies. Pass 2 (commercial cleaning) will be run later, so build the pass system now, but only run pass 1.

## Stack and setup

- Next.js (App Router) + TypeScript + Tailwind. Use `apify-client`, plus a small CSV writer (`csv-stringify` or hand-rolled with correct quoting).
- Secrets in `.env.local`: `APIFY_TOKENS=token1,token2,token3,...` (comma-separated, up to ~10). Never expose tokens to the browser and never log a full token (show the last 4 characters only).
- Runs execute server-side in Node API routes. Because the runs are long, use a background job runner inside the server process (a singleton with an in-memory queue). The UI polls `GET /api/status` every 2s or uses SSE. Persist state to `data/state.json` after every county so a server restart or crash can resume.
- Output: `data/output/pass-{n}-{name}/{county-slug}.csv` (e.g. `data/output/pass-1-janitorial/new-york.csv`, `.../st-lawrence.csv`). Also write raw actor items to `data/raw/pass-{n}/{county-slug}.json` for debugging.

## Passes (put in `config/scrape.config.ts` so I can edit them)

```ts
export const PASSES = {
  1: {
    name: "janitorial",
    searchTerms: ["janitorial service"],
    categoryFilter: ["Janitorial service"],
  },
  2: {
    name: "commercial-cleaning",
    searchTerms: ["commercial cleaning service", "office cleaning service"],
    categoryFilter: [
      "Commercial cleaning service",
      "Office cleaning service",
      "Janitorial service",
      "Cleaning service",
    ],
  },
};
export const ACTIVE_PASS = 1;
```

- Batch gates, county statuses and key-spend tracking are stored **per pass** in `state.json`. Changing `ACTIVE_PASS` (or a UI pass selector) starts a fresh 3-batch cycle without touching earlier passes.
- **Pass 2 dedupe rule:** when running pass 2, load the `placeId`s from the pass 1 CSV for the same county and drop rows already collected, so pass 2 files contain only new companies.
- Notes for the UI: a strict "Janitorial service" filter drops businesses that Google labels "Cleaning service" or "Commercial cleaning service". That is expected and is why pass 2 exists.

## Actor

- `client.actor("compass/crawler-google-places")` (same actor as ID `nwua9Gu5YrADL7ZDj`).
- Do NOT copy the huge sample input. Send only the fields below. Specifically, never send `startUrls`, `placeIds`, `customGeolocation`, `postalCode`, `city`, `county` or `state`, because they conflict with `locationQuery`.

```ts
const pass = PASSES[ACTIVE_PASS];
const input = {
  searchStringsArray: pass.searchTerms,
  locationQuery: `${county} County, New York, USA`,
  maxCrawledPlacesPerSearch: tierCap, // see tiers
  language: "en",
  countryCode: "us",
  categoryFilterWords: pass.categoryFilter,
  searchMatching: "all",
  skipClosedPlaces: true,
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
```

Verify the exact input field names against the actor's current input schema (fetch it via the API, or the actor page). Fix any names that have changed, and tell me what you changed.

Call it with `client.actor(ID).call(input, { maxTotalChargeUsd })` or start + poll `run.status` (your choice, but handle `FAILED`, `ABORTED`, `TIMED-OUT` and `SUCCEEDED`). Then read `client.dataset(run.defaultDatasetId).listItems()` (paginate with `limit`/`offset` so large datasets aren't truncated).

## Cost guard

- Price is about $4 per 1,000 results. Each key has a $5 limit, so only about $4.50 is usable.
- Set `maxTotalChargeUsd = cap * 0.004 * 1.25 * numberOfSearchTerms` for each county run (the cap applies per search term). If a run stops on this charge limit, mark the county `budget-capped` in the UI.
- Before each county, pick a key with enough remaining budget. Check remaining usage with the Apify user limits endpoint (`client.user("me").limits()` or `GET /v2/users/me/limits`). If that call isn't reliable, fall back to the spend tracked in `state.json` per key. A key needs at least the county's `maxTotalChargeUsd` plus a $0.25 buffer remaining.
- If a run fails for a key-related reason (HTTP 402/403, "insufficient credits", "monthly usage limit", "platform feature disabled"), mark the key `exhausted`, switch to the next key and retry the same county. This does NOT count against the normal retry attempts. If every key is exhausted, pause the whole job with a clear UI banner ("All keys exhausted: add keys to .env.local and click Resume").

## Tiered limits (`maxCrawledPlacesPerSearch`)

Put these in config:

- **Large, cap 400:** New York, Kings, Queens, Bronx, Nassau, Suffolk, Westchester
- **Mid, cap 150:** Richmond, Erie, Monroe, Onondaga, Albany, Orange, Rockland, Dutchess, Saratoga, Ulster, Oneida, Broome, Niagara, Schenectady, Rensselaer
- **Small, cap 60:** the other 40 counties

All 62 counties: Albany, Allegany, Bronx, Broome, Cattaraugus, Cayuga, Chautauqua, Chemung, Chenango, Clinton, Columbia, Cortland, Delaware, Dutchess, Erie, Essex, Franklin, Fulton, Genesee, Greene, Hamilton, Herkimer, Jefferson, Kings, Lewis, Livingston, Madison, Monroe, Montgomery, Nassau, New York, Niagara, Oneida, Onondaga, Ontario, Orange, Orleans, Oswego, Otsego, Putnam, Queens, Rensselaer, Richmond, Rockland, St. Lawrence, Saratoga, Schenectady, Schoharie, Schuyler, Seneca, Steuben, Suffolk, Sullivan, Tioga, Tompkins, Ulster, Warren, Washington, Wayne, Westchester, Wyoming, Yates.

Assert on startup that there are exactly 62 unique counties, and that every county has a tier.

If a county's returned result count (after filtering) reaches its cap, flag it `hit-cap` in the UI with a "Re-run with higher cap" button (an input where I can type the new cap).

## Batches (3 batches, about 21 counties each)

Generate the assignment in config, balanced by expected volume, and show it to me at the top of the UI:

- Large counties: New York, Nassau, Westchester go to Batch 1; Kings, Suffolk to Batch 2; Queens, Bronx to Batch 3.
- Mid counties: 5 per batch, round-robin in list order.
- Small counties: split 13/14/13 in alphabetical order.
  The assignment should be a plain editable array in the config file.

**Batch gate UI (important):**

- Show 3 batch panels. Each has its county list with per-county status: `pending`, `running`, `done`, `failed`, `hit-cap`, `budget-capped`. It also shows the row count, a CSV download link, and a "Run batch" button.
- Each batch has a **"Batch done? Yes / No"** control. "Run batch N+1" is disabled until batch N is marked Yes. Batch 1 is always runnable.
- When all counties in a batch finish, show a prompt ("Batch complete. Mark as done?"), but do not mark it automatically. I click Yes.
- Failed or incomplete counties can be retried individually. A batch can be marked Yes only if every county is `done`, `hit-cap` or `budget-capped`. Otherwise show what's still open.
- Include "Pause" and "Resume". Pause stops after the current county finishes. A resumed or restarted job skips counties already `done`.
- Include a small panel showing the keys: last 4 characters, status (`active`/`exhausted`) and estimated spend. Also show total estimated spend and total rows, and the active pass.

## Rate limiting and reliability (required)

- **Run counties sequentially, never in parallel.**
- **Sleep between counties:** a random 30–60 seconds (configurable), shown as a live countdown in the UI. Sleep also after a failed attempt before retrying.
- **Retry logic:** up to 3 attempts per county with exponential backoff plus jitter (about 30s, 90s, 270s). Retry on network errors, 429, 5xx, and run statuses `FAILED`/`TIMED-OUT`. Don't retry blindly on 4xx other than 429. Key-related errors rotate the key as described above. After 3 failures mark the county `failed` with the error message, and continue to the next county rather than stopping the batch.
- On a 429 from Apify, honor the `Retry-After` header if present.
- Log every attempt (county, pass, key suffix, attempt number, status, duration, result count, cost) to `data/logs/run.log` as JSON lines, and show the last ~50 lines in the UI.

## Data cleaning and CSV columns

After fetching items, for each county:

1. Drop rows where `state` is not "New York" (or where `countryCode` is not US).
2. Drop rows with `permanentlyClosed` or `temporarilyClosed` set to true.
3. Dedupe by `placeId` within the county. (Cross-county duplicates are expected from search spillover. I will merge and dedupe later, which is why `placeId` stays in the file.)
4. For pass 2, also drop `placeId`s already present in the pass 1 file for that county.
5. Keep only the useful fields below, in this column order, with these exact headers:

| CSV header      | Source field                              |
| --------------- | ----------------------------------------- | --- |
| Company Name    | `title`                                   |
| Category Name   | `categoryName`                            |
| All Categories  | `categories` (joined with `               | `)  |
| Address         | `address`                                 |
| Street          | `street`                                  |
| City            | `city`                                    |
| State           | `state`                                   |
| Zip             | `postalCode`                              |
| Phone           | `phone` (fall back to `phoneUnformatted`) |
| Website         | `website`                                 |
| Rating          | `totalScore`                              |
| Review Count    | `reviewsCount`                            |
| Google Maps URL | `url`                                     |
| Place ID        | `placeId`                                 |
| Target County   | the county I searched (set by the app)    |
| Batch           | 1, 2 or 3                                 |
| Pass            | 1 or 2                                    |
| Scraped At      | ISO date                                  |

The Category Name column matters to me. I will filter on it in a spreadsheet later, so keep the value exactly as the actor returns it and do not filter beyond the actor-level category filter.

Write the CSV as UTF-8 with a BOM so that Excel and Google Sheets open it correctly. Write each file atomically (temp file, then rename). Re-running a county overwrites its CSV.

## Also include

- A "Download all" button that zips the active pass's CSVs (or just links each one if the zip is too much work).
- A README with: setup, `.env.local` example, how passes and batches work, and how to add more keys.
- Add `data/` and `.env.local` to `.gitignore`.
- A `--dry-run` mode (env flag `DRY_RUN=1`) that uses fake data and short sleeps, so I can test the whole UI and gating flow without spending credits. Test it before touching real keys.

## Order of work

1. Scaffold, config, state, and the dry-run flow with the full UI and batch gating.
2. Verify the actor input schema, and run ONE real small county (e.g. Hamilton, cap 60) with pass 1 to confirm field names and the cleaning step. Show me the resulting CSV head and cost.
3. Stop there and ask me before running any batch for real.
