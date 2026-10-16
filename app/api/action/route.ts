import { NextResponse } from "next/server";
import { noStore, requireRole, viewFor } from "@/lib/api";
import { type Action, ActionError, applyAction, phaseOf } from "@/lib/model";
import { archiveSignedWeek, updateState } from "@/lib/store";

export async function POST(req: Request) {
  const role = await requireRole();
  if (role instanceof NextResponse) return role;
  const action = (await req.json().catch(() => null)) as Action | null;
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const state = await updateState((s) => applyAction(s, role, action, new Date().toISOString()));
    if (action.type === "signOff" && phaseOf(state.weeks[action.week]) === "signed") {
      await archiveSignedWeek(state, action.week).catch((e) => console.error("archive failed", e));
    }
    return NextResponse.json({ state: viewFor(role, state) }, { headers: noStore });
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: "Something went wrong saving. Please try again." }, { status: 500 });
  }
}
