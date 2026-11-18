# County Scraper

A local Next.js app that runs the Apify Google Maps scraper county by county, one state at a
time, in 3 gated batches per state. It writes one CSV per county.

## States

Pick the state with the **State** dropdown in the header. Each state has its own batches,
progress and files. Only one state can have a running or paused job at a time, because all
states share the same keys.

| State | Counties | Caps (large / mid / small) | Status |
| --- | --- | --- | --- |
| New York | 62 | 400 / 150 / 60 | Pass 1 finished 2026-11-09: 1,753 rows, $8.96 |
| Arkansas | 75 | 200 / 100 / 60 | Pass 1 finished 2026-11-10: 376 rows, $1.95 |

Arkansas caps are lower because it has about 3.0M people, compared with New York's 19.5M.
Pulaski (Little Rock) is about the size of Erie County, NY, which returned 126 results. A
small-county cap below 60 would save nothing, because $0.50 is the lowest charge limit the actor accepts.

**To add a state:** copy `config/regions/arkansas.ts`, fill in the counties, tiers and batches,
add it to `REGIONS` in `config/regions/index.ts`, then run `npm test`.

## Setup

```
npm install
npm run dev
```

Open http://localhost:3000. The app runs locally only and is not built for serverless hosting.

## Keys

Put keys in `.env`, one per line, as `name - token`:

```
khalid - apify_api_xxxxxxxxxxxxxxxxxxxx
ashik - apify_api_xxxxxxxxxxxxxxxxxxxx
nahid - apify_api_xxxxxxxxxxxxxxxxxxxx
```

Keys are used top to bottom. The UI shows only the name and last 4 characters.

**To add a key:** add a line at the bottom of `.env` and click Resume, or just start the
next batch. No restart is needed.

Before each county, the app takes the first key with enough budget left, which means
the run's charge limit plus $0.25. It reads the balance from Apify and falls back on its
own tracked spend if that call fails. If a county costs more than any key has left, the
app moves on to cheaper counties. Once nothing in the queue can run, it pauses with a banner.

## Dry run

Test the whole flow with fake data, without spending credits:

```
npm run dev:dry
```

Dry runs use `data/dry-run/{state}/`, with fake keys in `data/dry-run/keys.env`, so they never
touch real data. `DRY_KEY_LIMIT_USD=1` sets a lower fake budget per key.

These New York counties are scripted to show each status. Every other state gets clean runs:

| County | What happens |
| --- | --- |
| Nassau | `hit-cap` |
| Ulster | `budget-capped` |
| Chemung | Fails 3 times, then works on a manual retry |
| Cayuga | Fails twice, then recovers |
| Allegany | Times out once |
| Clinton | First key is out of credit, so the app switches keys |
| Essex | Gets a 429 with `Retry-After` |
| Columbia | Gets a network error |

## Passes

Passes live in `config/scrape.config.ts`. Each pass has its own batch gates, county statuses
and key spend in `data/{state}/state.json`. Changing `ACTIVE_PASS`, or using the selector in the UI,
starts a fresh cycle without touching earlier passes.

Pass 2 drops every `placeId` already in the pass 1 CSV for that county, so its files hold
only new companies.

`categoryFilter` values must be lowercase and on the actor's list, or Apify rejects the run.
For example, `commercial cleaning service` is not on the list. A place matches if any of
its categories contains all the words of a value. `cleaning service` therefore also pulls in
house, carpet, window and pool cleaners, which is why pass 2 stays on `janitorial service`.

## Batches

The assignment is a plain array per state in `config/regions/{state}.ts`. A batch unlocks when the one
before it is marked Yes. You can only mark Yes when every county is `done`, `hit-cap` or
`budget-capped`. The app never marks a batch by itself.

- **Pause** stops after the current county finishes.
- **Resume** continues the queue, skipping finished counties.
- After a crash or restart, the job comes back paused. Resume reattaches to the Apify run
  that was in progress, so it isn't paid for twice.

## Cost

The price is $0.005 per place: $0.004 per place plus $0.001 for the category filter. Places
filtered out are not billed. `skipClosedPlaces` is deliberately not sent, because it costs an
extra $0.001 per place and cleaning removes closed places anyway.

Each run's charge limit is `max($0.50, cap × $0.005 × 1.25 × search terms)`. The actor
rejects any limit under $0.50.

| Tier | Cap | Most a run can spend | Charge limit |
| --- | --- | --- | --- |
| Large | 400 | $2.00 | $2.50 |
| Mid | 150 | $0.75 | $0.94 |
| Small | 60 | $0.30 | $0.50 |

If a county shows `hit-cap` or `budget-capped`, enter a higher cap and re-run it. A higher cap
raises the charge limit too.

## Cleaning

For each county, the app:

1. Drops rows where `state` is filled in and isn't the state being scraped (full name or code), or `countryCode` is filled in
   and isn't US.
2. Drops permanently or temporarily closed places.
3. Dedupes by `placeId` within the county.
4. In pass 2, drops `placeId`s already in the pass 1 file.

**Blank state is kept on purpose.** Service-area businesses hide their address, so Address,
Street, City, State and Zip are blank for them. The actor still limits them to the county by
coordinates.

`Category Name` is left exactly as the actor returns it. The filter also matches secondary
categories, so that column can hold something other than "Janitorial service".

## Files

```
config/scrape.config.ts                             passes, pricing, timing
config/regions/{state}.ts                           counties, tiers (caps) and batches per state
data/{state}/output/pass-1-janitorial/{county}.csv  one CSV per county (UTF-8 with BOM)
data/{state}/raw/pass-1/{county}.json               raw actor items, for debugging
data/{state}/logs/run.log                           one JSON line per attempt
data/{state}/state.json                             progress, used to resume
```

`{state}` is `new-york` or `arkansas`.

Close a county's CSV in Excel before re-running it, because Windows locks open files. The app
waits up to a minute, then marks the county `failed` and tells you which file to close.

## Tests

```
npm test
npm run typecheck
```
