import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { NextResponse } from "next/server";
import { REGIONS } from "@/config/regions";
import { PASSES, slugOf } from "@/config/scrape.config";
import { outputDir, passDirName } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pass = Number(params.get("pass"));
  const region = REGIONS.find((r) => r.slug === (params.get("state") ?? "new-york"));
  if (!PASSES[pass] || !region) return new NextResponse("Not found", { status: 404 });
  const BATCHES = region.batches;

  // Optional ?batch=n limits the zip to that batch's counties.
  const batchParam = params.get("batch");
  const batch = batchParam === null ? null : Number(batchParam);
  if (batch !== null && !BATCHES[batch]) return new NextResponse("Not found", { status: 404 });
  const allowed = batch === null ? null : new Set(BATCHES[batch].map((c) => `${slugOf(c)}.csv`));

  const dir = outputDir(region.slug, pass);
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".csv") && (!allowed || allowed.has(f)))
    : [];
  if (files.length === 0) return new NextResponse("No CSV files yet", { status: 404 });

  const zip = new JSZip();
  for (const f of files) zip.file(f, fs.readFileSync(path.join(dir, f)));
  const body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${region.slug}-${passDirName(pass)}${batch === null ? "" : `-batch-${batch}`}.zip"`,
    },
  });
}
