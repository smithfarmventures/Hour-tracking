import { NextResponse } from "next/server";
import { roleForPin, setSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { pin } = await req.json().catch(() => ({ pin: "" }));
  const role = typeof pin === "string" ? roleForPin(pin.trim()) : null;
  if (!role) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 1500));
    return NextResponse.json({ error: "That PIN didn't match" }, { status: 401 });
  }
  await setSession(role);
  return NextResponse.json({ role });
}
