import { NextResponse } from "next/server";
import { REGIONS } from "@/config/regions";
import { getRunner } from "@/lib/runner";

export const dynamic = "force-dynamic";

type Action = { state?: string } & (
  | { type: "run-batch"; batch: number }
  | { type: "run-county"; county: string; cap?: number }
  | { type: "batch-done"; batch: number; done: boolean }
  | { type: "set-pass"; pass: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "refresh-keys" }
);

export async function POST(req: Request) {
  const action = (await req.json()) as Action;
  if (action.state && !REGIONS.some((r) => r.slug === action.state)) {
    return NextResponse.json({ error: `Unknown state ${action.state}` }, { status: 400 });
  }
  try {
    const runner = getRunner(action.state);
    switch (action.type) {
      case "run-batch":
        runner.runBatch(action.batch);
        break;
      case "run-county":
        runner.runCounty(action.county, action.cap);
        break;
      case "batch-done":
        runner.setBatchDone(action.batch, action.done);
        break;
      case "set-pass":
        runner.setPass(action.pass);
        break;
      case "pause":
        runner.pause();
        break;
      case "resume":
        await runner.resume();
        break;
      case "refresh-keys":
        await runner.refreshKeys(); // Read-only: asks Apify for each key's usage, spends nothing.
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
