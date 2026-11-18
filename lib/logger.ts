import fs from "node:fs";
import path from "node:path";
import { logFile } from "./paths";

export type LogEntry = {
  ts: string;
  county: string;
  pass: number;
  key: string;
  attempt: number;
  status: string;
  durationMs: number;
  resultCount: number;
  costUsd: number;
  note?: string;
};

export function writeLog(region: string, entry: Omit<LogEntry, "ts">) {
  const file = logFile(region);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export function tailLog(region: string, count: number): LogEntry[] {
  const file = logFile(region);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").slice(-count);
  return lines.filter(Boolean).map((line) => JSON.parse(line) as LogEntry);
}
