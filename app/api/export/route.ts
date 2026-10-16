import { NextResponse } from "next/server";
import { requireRole } from "@/lib/api";
import { signedWeeksCsv } from "@/lib/model";
import { loadState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const role = await requireRole();
  if (role instanceof NextResponse) return role;
  const { state } = await loadState();
  return new NextResponse(signedWeeksCsv(state), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nanny-hours-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
