import { NextResponse } from "next/server";
import { errorResponse, noStore } from "@/lib/api";
import { newKeys, setAccessCookie } from "@/lib/auth";
import { updateState } from "@/lib/store";

class AlreadySetUp extends Error {}

/** First-run setup: whoever opens the fresh site first becomes the parent on that device. */
export async function POST() {
  try {
    const state = await updateState((s) => {
      if (s.access) throw new AlreadySetUp();
      return { ...s, access: newKeys() };
    });
    await setAccessCookie(state.access!.parentKey);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    if (e instanceof AlreadySetUp) {
      return NextResponse.json({ error: "This app is already set up. Ask the parents for your link." }, { status: 409 });
    }
    return errorResponse(e);
  }
}
