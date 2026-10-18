import { NextResponse } from "next/server";
import { errorResponse, noStore, withRole } from "@/lib/api";
import { newKeys } from "@/lib/auth";
import { updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The calendar subscription URL (anyone signed in). Created on first request. */
export async function GET(req: Request) {
  const ctx = await withRole();
  if (ctx instanceof NextResponse) return ctx;
  try {
    let key = ctx.state.access?.calendarKey;
    if (!key) {
      const state = await updateState((s) =>
        s.access?.calendarKey ? s : { ...s, access: { ...s.access!, calendarKey: newKeys().calendarKey } },
      );
      key = state.access!.calendarKey!;
    }
    const url = new URL(`/cal/${key}.ics`, req.url);
    url.protocol = "https:";
    return NextResponse.json({ https: url.toString(), webcal: url.toString().replace(/^https:/, "webcal:") }, { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
