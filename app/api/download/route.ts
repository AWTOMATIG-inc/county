import fs from "node:fs";
import { NextResponse } from "next/server";
import { REGIONS, allCounties } from "@/config/regions";
import { PASSES, slugOf } from "@/config/scrape.config";
import { csvPath } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const pass = Number(params.get("pass"));
  // Matching against the known lists keeps the query from reaching any other path.
  const region = REGIONS.find((r) => r.slug === (params.get("state") ?? "new-york"));
  const county = region && allCounties(region).find((c) => slugOf(c) === params.get("county"));
  if (!PASSES[pass] || !region || !county) return new NextResponse("Not found", { status: 404 });

  const file = csvPath(region.slug, pass, county);
  if (!fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(fs.readFileSync(file), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${region.slug}-pass-${pass}-${slugOf(county)}.csv"`,
    },
  });
}
