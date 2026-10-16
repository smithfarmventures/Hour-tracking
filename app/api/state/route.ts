import { NextResponse } from "next/server";
import { noStore, viewFor, withRole } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await withRole();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ role: ctx.role, state: viewFor(ctx.role, ctx.state) }, { headers: noStore });
}
