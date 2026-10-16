import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { errorResponse, noStore, viewFor } from "@/lib/api";
import { COOKIE, roleForKey } from "@/lib/auth";
import { type Action, type Role, ActionError, applyAction, phaseOf } from "@/lib/model";
import { archiveSignedWeek, updateState } from "@/lib/store";

class NotSignedIn extends Error {}

export async function POST(req: Request) {
  const action = (await req.json().catch(() => null)) as Action | null;
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const key = (await cookies()).get(COOKIE)?.value;
  let role: Role | null = null;
  try {
    // Check the device's access against the same state the action applies to.
    const state = await updateState((s) => {
      role = roleForKey(s, key);
      if (!role) throw new NotSignedIn();
      return applyAction(s, role, action, new Date().toISOString());
    });
    if (action.type === "signOff" && phaseOf(state.weeks[action.week]) === "signed") {
      await archiveSignedWeek(state, action.week).catch((e) => console.error("archive failed", e));
    }
    return NextResponse.json({ state: viewFor(role!, state) }, { headers: noStore });
  } catch (e) {
    if (e instanceof NotSignedIn) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: 400 });
    return errorResponse(e);
  }
}
