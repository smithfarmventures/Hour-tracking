import { NextResponse } from "next/server";
import { noStore, requireRole, viewFor } from "@/lib/api";
import { loadState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const role = await requireRole();
  if (role instanceof NextResponse) return role;
  const { state } = await loadState();
  return NextResponse.json({ role, state: viewFor(role, state) }, { headers: noStore });
}
