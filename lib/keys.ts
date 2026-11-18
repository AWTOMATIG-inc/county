import fs from "node:fs";
import { atomicWrite, isDryRun, keysFile } from "./paths";

export type ApiKey = { name: string; token: string; suffix: string };

/**
 * Reads lines shaped like `khalid - apify_api_xxxx`, in file order.
 * Other lines (such as DRY_RUN=1) are ignored. The file is re-read each time,
 * so keys added to it are picked up on Resume without a restart.
 */
export function parseKeys(text: string): ApiKey[] {
  const keys: ApiKey[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const match = raw.trim().match(/^(?:(.+?)\s+-\s+)?(apify_api_\S+)$/);
    if (!match) continue;
    const token = match[2];
    keys.push({ name: match[1] ?? `key-${keys.length + 1}`, token, suffix: token.slice(-4) });
  }
  return keys;
}

const FAKE_KEYS = [
  "dry-a - apify_api_fakekey0aaaa",
  "dry-b - apify_api_fakekey0bbbb",
  "dry-c - apify_api_fakekey0cccc",
  "",
].join("\n");

export function loadKeys(): ApiKey[] {
  const file = keysFile();
  if (isDryRun() && !fs.existsSync(file)) atomicWrite(file, FAKE_KEYS);
  if (!fs.existsSync(file)) return [];
  return parseKeys(fs.readFileSync(file, "utf8"));
}

export const isKeyError = (status: number | undefined, message: string) =>
  status === 401 ||
  status === 402 ||
  status === 403 ||
  /insufficient|not enough usage|monthly usage|usage limit|platform[- ]feature|feature.*disabled/i.test(message);
