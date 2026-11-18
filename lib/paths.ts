import fs from "node:fs";
import path from "node:path";
import { PASSES, slugOf } from "@/config/scrape.config";

export const isDryRun = () => process.env.DRY_RUN === "1";

/** Dry runs get their own folder so fake data can never mix with real data. */
export const baseRoot = () => path.join(process.cwd(), "data", ...(isDryRun() ? ["dry-run"] : []));

/** Each state keeps its progress, CSVs, raw items and log in data/{state}/. Keys are shared. */
export const dataRoot = (region: string) => path.join(baseRoot(), region);

export const stateFile = (region: string) => path.join(dataRoot(region), "state.json");
export const logFile = (region: string) => path.join(dataRoot(region), "logs", "run.log");
export const keysFile = () =>
  isDryRun() ? path.join(baseRoot(), "keys.env") : path.join(process.cwd(), ".env");

export const passDirName = (pass: number) => `pass-${pass}-${PASSES[pass].name}`;
export const outputDir = (region: string, pass: number) =>
  path.join(dataRoot(region), "output", passDirName(pass));
export const csvPath = (region: string, pass: number, county: string) =>
  path.join(outputDir(region, pass), `${slugOf(county)}.csv`);
export const rawPath = (region: string, pass: number, county: string) =>
  path.join(dataRoot(region), "raw", `pass-${pass}`, `${slugOf(county)}.json`);

const BUSY = new Set(["EPERM", "EBUSY", "EACCES"]);
export const isFileBusy = (err: unknown) => BUSY.has((err as NodeJS.ErrnoException)?.code ?? "");

function blockFor(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Writes a temp file, then renames it. Windows can briefly lock files, so rename retries. */
export function atomicWrite(file: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (!isFileBusy(err) || attempt >= 10) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      blockFor(100);
    }
  }
}
