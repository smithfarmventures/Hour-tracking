import { NextResponse } from "next/server";
import { errorResponse, noStore, withRole } from "@/lib/api";
import { newKeys, setAccessCookie } from "@/lib/auth";
import { updateState } from "@/lib/store";

export const dynamic = "force-dynamic";

function links(req: Request, access: { parentKey: string; nannyKey: string }) {
  const origin = new URL(req.url).origin;
  return { nanny: `${origin}/join/${access.nannyKey}`, parent: `${origin}/join/${access.parentKey}` };
}

/** The personal sign-in links (parents only). */
export async function GET(req: Request) {
  const ctx = await withRole();
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.role !== "parent") return NextResponse.json({ error: "Only the parents can do that" }, { status: 403 });
  return NextResponse.json(links(req, ctx.state.access!), { headers: noStore });
}

/** Replace both links. Every other device, including the nanny's, is signed out. */
export async function POST(req: Request) {
  const ctx = await withRole();
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.role !== "parent") return NextResponse.json({ error: "Only the parents can do that" }, { status: 403 });
  try {
    const next = await updateState((s) => ({ ...s, access: newKeys() }));
    await setAccessCookie(next.access!.parentKey);
    return NextResponse.json(links(req, next.access!), { headers: noStore });
  } catch (e) {
    return errorResponse(e);
  }
}
