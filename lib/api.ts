import { NextResponse } from "next/server";
import { roleFromCookie } from "./auth";
import type { Role, State } from "./model";
import { StorageMissingError, loadState } from "./store";

export const noStore = { "Cache-Control": "no-store" };

/** What a role gets to see: never the access keys, and the nanny doesn't see unsent drafts. */
export function viewFor(role: Role, state: State): Omit<State, "access"> {
  const { access: _secret, ...rest } = state;
  if (role === "parent") return rest;
  const weeks = Object.fromEntries(Object.entries(state.weeks).filter(([, w]) => w.sentAt));
  return { ...rest, weeks };
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof StorageMissingError) {
    return NextResponse.json({ error: e.message, storageMissing: true }, { status: 503, headers: noStore });
  }
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500, headers: noStore });
}

/** Loads state and the signed-in role, or returns the response to send instead. */
export async function withRole(): Promise<{ role: Role; state: State } | NextResponse> {
  try {
    const { state } = await loadState();
    const role = await roleFromCookie(state);
    if (!role) {
      return NextResponse.json(
        { error: "Not signed in", setupNeeded: !state.access },
        { status: 401, headers: noStore },
      );
    }
    return { role, state };
  } catch (e) {
    return errorResponse(e);
  }
}
