import { NextResponse } from "next/server";
import { withRole } from "@/lib/api";
import { signedWeeksCsv } from "@/lib/model";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await withRole();
  if (ctx instanceof NextResponse) return ctx;
  return new NextResponse(signedWeeksCsv(ctx.state), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nanny-hours-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
