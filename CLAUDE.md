@AGENTS.md

# County Scraper (multi-state)

A local Next.js app (App Router, TypeScript, Tailwind, no database) that runs the Apify actor
`compass/crawler-google-places` county by county, one state at a time, in 3 gated batches per
state, and writes one CSV per county. It started as New York only (brief: `prompt.md`). Since
2026-11-10 it supports several states, picked with a **State** dropdown in the header.
New York (62 counties), Arkansas (75) and Florida (67, added 2026-11-18, caps 400/150/60) are configured.
`README.md` covers usage. Current progress lives in Claude's memory, not in this file.

## Rules

- **Never start a real batch or a real county run without the user's go-ahead.** Each one
  spends Apify credit. Reading `data/` or running `npm run dev:dry` is fine.
- **Never print a full API token.** Use the last 4 characters only. Keys are in `.env`,
  one per line as `name - apify_api_...`, used top to bottom. The user adds keys at the bottom.
- **Never rerun a county unless asked.** A rerun overwrites its CSV and costs money.
- When a decision is the user's to make, ask with a recommended option.
- Commits and PRs carry no Claude attribution (see the global CLAUDE.md). Git repo since
  2026-11-18, remote `git@github.com:AWTOMATIG-inc/county.git` (**public**), branch `main`.
  Push over SSH: HTTPS uses the khalidhasananik login, which gets a 403. `.env`, `data/`,
  backups and `some.txt` (old tokens) are gitignored. Never commit tokens or scraped data.
- **Log everything in memory.** After any change, decision, real run, data check or balance
  check, add a dated entry (newest at the bottom) to the `work-log` memory file
  (`memory/work-log.md` in Claude's memory folder). Each entry says what was done, the result,
  and any numbers (rows, cost, key balances by last 4 characters only). Also keep the
  `county-scrape-rollout` memory up to date with the current state of every state and batch,
  and keep `MEMORY.md` pointing to both files. Do this before ending the turn.
- **Log as you go, without being asked.** In every conversation, as soon as something is worth
  keeping, write it down right then. Don't wait for the user to ask or for the session to end.
  - **Memory** gets progress, runs, results, balances and user decisions.
  - **This file** gets lasting facts about the code, the actor or a rule the user sets.
  - **At the start of a session, and before advising on progress,** compare `data/*/state.json`
    and `.env` with memory. The user runs batches and adds keys in the UI without saying so, so
    log anything new you find, such as runs, new keys or batch marks.

## Terms the user uses

| Term | Meaning |
| --- | --- |
| **cap** | Most results scraped per county (`maxCrawledPlacesPerSearch`), set by tier. Not a radius: every search covers the whole county. |
| **tier** | large / mid / small, which sets a county's cap |
| **charge limit** | Most dollars one county run may spend (`maxTotalChargeUsd`), worked out from the cap |
| **hit cap** | A county returned as many results as its cap |
| **batch** | One of the 3 county groups per state |
| **pass** | One search type: 1 = janitorial, 2 = commercial/office cleaning |

If the user says "limit" alone, ask whether they mean the cap or the charge limit.

## Commands

```
npm run dev       # real mode, http://localhost:3000
npm run dev:dry   # fake data in data/dry-run/, no credits used
npm test          # vitest, tests/core.test.ts
npm run typecheck
npx next build
```

TypeScript is pinned to 5.9 because Next needs the TS JS API, which TS 7 doesn't have.

## Layout

| Path | What it is |
| --- | --- |
| `config/scrape.config.ts` | Passes, pricing, timing, and `validateConfig()` (shared by all states) |
| `config/regions/*.ts` | One file per state: name, postal code, county count, tiers with caps, batch arrays. Listed in `config/regions/index.ts` (`REGIONS`). "Region" in code, "State" in the UI. |
| `lib/runner.ts` | One runner per state on `globalThis` (`getRunner(slug)`): queue, key picking, retries, pause and resume, reattaching after a crash. Key balances are shared, and only one state may have a running or paused job at a time. |
| `lib/apify.ts` | Real scraper. Runs start with a direct `fetch` POST so `Retry-After` can be read, since `apify-client` hides headers. Everything else uses `apify-client`. |
| `lib/dryrun.ts` | Fake scraper with scripted counties for testing (see README) |
| `lib/clean.ts` | Cleaning rules (keeps rows whose state is the scraped state's name or code, or blank), CSV writer (BOM, exact headers), Place ID reader for the pass 2 dedupe |
| `lib/keys.ts` | `.env` parser and key-error detection |
| `lib/state.ts` | `data/{state}/state.json`, with batch gates, statuses and key spend stored per pass |
| `app/api/{status,action,download,download-all}` | API routes, all taking `?state=<slug>` (action takes `state` in the body; default `new-york`). Status never includes tokens. `download-all?state=s&pass=n` zips a pass, and adding `&batch=n` zips one batch. The `refresh-keys` action re-reads balances. |
| `components/Dashboard.tsx` | The whole UI, polling `/api/status?state=` every 2s. The state choice is kept in `?state=` and localStorage. |

**To add a state:** copy `config/regions/arkansas.ts`, fill in counties, tiers and batches,
add it to `REGIONS`, and run `npm test`. `validateRegions()` checks the counts at startup.

## UI features added after the first build (2026-11-09)

- Each batch panel has a **Download zip** button next to Run batch, which appears once the
  batch has a CSV, and a **Total** row under the county table with rows and cost.
- The Totals card shows **Apify spent this month** and **Left on all keys**. These are live
  numbers from `/users/me/limits`, summed over keys, with a **Refresh balances** button.
  The Keys card shows Used / month, Left and Resets for each key.
  - `Scraper.balance(key)` returns `{limitUsd, usedUsd, resetsAt}`, and the runner keeps it
    in `runner.balances`.
  - Balances refresh at server start, after each county, on Resume and with the button.
- The runners live on `globalThis`, so a change to the Runner class needs a dev
  server restart. Before the restart, `/api/status` returns 500. A restart is safe only
  while the job is idle.
- Checking balances costs nothing, so it's fine to do without asking. The quick way is to
  call `/users/me/limits` for each `.env` key and print only the suffix.

Each state has its own folder `data/{state}/` (for example `data/new-york/`, `data/arkansas/`):
output goes to `output/pass-{n}-{name}/{slug}.csv`, raw items to `raw/pass-{n}/`, one JSON
line per attempt to `logs/run.log`, and progress to `state.json`. Dry runs use
`data/dry-run/{state}/`. `data/`, `.env` and `backup-*.zip` are gitignored. The NY data was
moved from `data/` into `data/new-york/` on 2026-11-10, with a full backup in
`backup-data-2026-11-10.zip` at the project root.

## Actor facts verified against the live API (2026-11-06)

- All 18 input field names in the brief are correct. Never send `startUrls`, `placeIds`,
  `customGeolocation`, `postalCode`, `city`, `county` or `state`, because they conflict
  with `locationQuery`.
- `categoryFilterWords` values must be **lowercase** and on the actor's list of about 4,000
  values. `"Janitorial service"` is rejected, and `"commercial cleaning service"` and
  `"office cleaning service"` don't exist. A place matches if any of its categories contains
  all the words of a value.
- The actor rejects `maxTotalChargeUsd` below **$0.50**, with the error
  `max-total-charge-usd-below-minimum`.
- Pricing on the free plan, per place:

  | Charge | Price |
  | --- | --- |
  | `place-scraped` | $0.004 |
  | `filter-applied` | $0.001 per filter |
  | Run start | About $0.0002 |

  Places that get filtered out aren't billed.
- The actor clips results to the county polygon, so spillover from other counties is small.
- Service-area businesses come back with `address`, `city`, `state`, `postalCode` and
  `countryCode` all null.
- Apify accounts are on the FREE plan with a $5 monthly limit. Balances come from
  `GET /v2/users/me/limits`.

## Decisions made with the user

1. **No `skipClosedPlaces`:** it's a paid filter, and cleaning drops closed places anyway.
   Price is $0.005 per place.
2. **Charge limit:** `max(0.50, cap × 0.005 × 1.25 × search terms)`. A key needs the limit
   plus $0.25 left.
   - New York (caps 400/150/60): $2.50 / $0.94 / $0.50.
   - Arkansas (caps 200/100/60): $1.25 / $0.63 / $0.50.
   - Size each new state's caps to its population. A small cap below 60 saves nothing,
     because $0.50 is the minimum charge limit.
3. **Rows with a blank state are kept.** Only a state filled in with something other than the
   state being scraped (full name or postal code), or a country other than US, is dropped.
   Address fields stay blank for those rows.
4. **Pass 2:** search terms are `commercial cleaning service` and `office cleaning service`,
   with the filter kept to `janitorial service` only. The user said commercial cleaning pulls
   in too much. Pass 2 also drops Place IDs that are already in the pass 1 CSV for the county.
5. **Key handling:** keys are read from `.env` in file order and re-read on Resume, so new
   keys work without a restart. Resume resets keys marked exhausted. If no key can afford a
   county, cheaper counties run first, and the job pauses once nothing can run.
6. **Batches:** a batch unlocks only after the previous one is marked Yes, and the app never
   marks it automatically. Yes is allowed only when every county is `done`, `hit-cap` or
   `budget-capped`.
7. **Multi-state (2026-11-10):**
   - Each state has 3 batches. Large counties are spread one per batch, mid counties
     round-robin by population, and small counties alphabetical.
   - Only one state can have a job at a time, because all states share the keys.
   - New states get janitorial pass 1 only, the same as New York, plus one cheap real test
     county before batch 1. The test county must be in batch 1, because batch 2 is locked.
   - The UI has no Run button for a single pending county. Use the `run-county` action
     through the API.
8. **Pause between counties is 5–10s (2026-11-18),** down from the brief's 30–60s. In Arkansas,
   the waiting (80 min) took longer than the scraping (58 min). Switching keys also waits 5s now.
   Counties still run one at a time. The user chose not to run several at once.

## Not yet seen with real data

- A run that actually stops at its charge limit. `budget-capped` is detected from cost close
  to the limit plus the status message.
- A real 429 response.
- A real `hit-cap`. No county in New York or Arkansas reached its cap. The closest was
  Pulaski, AR, with 126 of 200.
- A real failed run. All 137 county runs so far succeeded on the first attempt.
