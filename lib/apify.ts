import { ApifyClient } from "apify-client";
import { ACTOR_ID } from "@/config/scrape.config";
import type { Item } from "./clean";
import type { ApiKey } from "./keys";
import { ApiFailure, type RunInfo, type Scraper, type StartOptions } from "./scraper";

const API = "https://api.apify.com/v2";
const PAGE_SIZE = 1000;

const client = (key: ApiKey) => new ApifyClient({ token: key.token });

function toFailure(err: unknown): ApiFailure {
  if (err instanceof ApiFailure) return err;
  const e = err as { message?: string; statusCode?: number };
  return new ApiFailure(e?.message ?? String(err), e?.statusCode);
}

export const apifyScraper: Scraper = {
  // A direct request instead of client.actor().start(): apify-client hides response
  // headers, and the Retry-After header on a 429 has to be honored.
  async start(key, input, opts: StartOptions) {
    const actor = ACTOR_ID.replace("/", "~");
    const url = `${API}/acts/${actor}/runs?maxTotalChargeUsd=${opts.maxTotalChargeUsd}&timeout=${opts.timeoutSecs}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } catch (err) {
      throw new ApiFailure(`Network error: ${(err as Error).message}`);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new ApiFailure(
        body?.error?.message?.slice(0, 500) ?? `HTTP ${res.status}`,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return body.data.id as string;
  },

  async getRun(key, runId): Promise<RunInfo> {
    try {
      const run = await client(key).run(runId).get();
      if (!run) throw new ApiFailure(`Run ${runId} not found`, 404);
      return {
        status: run.status,
        message: run.statusMessage ?? "",
        costUsd: run.usageTotalUsd ?? 0,
        datasetId: run.defaultDatasetId,
      };
    } catch (err) {
      throw toFailure(err);
    }
  },

  async abort(key, runId) {
    await client(key).run(runId).abort().catch(() => undefined);
  },

  async items(key, datasetId) {
    const dataset = client(key).dataset(datasetId);
    const all: Item[] = [];
    try {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await dataset.listItems({ limit: PAGE_SIZE, offset, clean: true });
        all.push(...(page.items as Item[]));
        if (page.items.length < PAGE_SIZE) return all;
      }
    } catch (err) {
      throw toFailure(err);
    }
  },

  async balance(key) {
    try {
      const limits = await client(key).user("me").limits();
      if (!limits) return null;
      const endAt = limits.monthlyUsageCycle?.endAt as Date | string | undefined;
      return {
        limitUsd: limits.limits.maxMonthlyUsageUsd,
        usedUsd: limits.current.monthlyUsageUsd,
        resetsAt: endAt ? new Date(endAt).toISOString() : undefined,
      };
    } catch {
      return null;
    }
  },
};
