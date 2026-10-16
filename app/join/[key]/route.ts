import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { roleForKey, setAccessCookie } from "@/lib/auth";
import { loadState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Opening a personal link signs this device in for good, then goes to the app. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  try {
    const { state } = await loadState();
    const role = roleForKey(state, key);
    const url = new URL(role ? "/" : "/?link=invalid", req.url);
    if (role) await setAccessCookie(key);
    const res = NextResponse.redirect(url, 303);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
