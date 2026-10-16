import { NextResponse } from "next/server";
import { currentRole } from "./auth";
import type { Role, State } from "./model";

/** What a role gets to see: the nanny doesn't see unsent drafts. */
export function viewFor(role: Role, state: State): State {
  if (role === "parent") return state;
  const weeks = Object.fromEntries(Object.entries(state.weeks).filter(([, w]) => w.sentAt));
  return { ...state, weeks };
}

export async function requireRole(): Promise<Role | NextResponse> {
  const role = await currentRole();
  return role ?? NextResponse.json({ error: "Please sign in" }, { status: 401 });
}

export const noStore = { "Cache-Control": "no-store" };
