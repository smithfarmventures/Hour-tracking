// PIN-based login for exactly two people. Each person's PIN lives in an env var;
// a successful login sets a signed, httpOnly cookie naming their role. The
// signing key includes the PIN, so changing a PIN logs that person out everywhere.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "./model";

export const COOKIE = "session";
const MAX_AGE_S = 60 * 60 * 24 * 180; // stay signed in on a phone for ~6 months

function pins(): Record<Role, string> {
  const parent = process.env.PARENT_PIN ?? "";
  const nanny = process.env.NANNY_PIN ?? "";
  if (!parent || !nanny || !process.env.SESSION_SECRET) {
    throw new Error("PARENT_PIN, NANNY_PIN and SESSION_SECRET must be set");
  }
  if (parent === nanny) throw new Error("PARENT_PIN and NANNY_PIN must differ");
  return { parent, nanny };
}

function sign(role: Role, expires: number): string {
  const key = process.env.SESSION_SECRET + ":" + pins()[role];
  return createHmac("sha256", key).update(`${role}.${expires}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function roleForPin(pin: string): Role | null {
  const p = pins();
  // Check both so timing doesn't reveal which one matched.
  const isParent = safeEqual(pin, p.parent);
  const isNanny = safeEqual(pin, p.nanny);
  return isParent ? "parent" : isNanny ? "nanny" : null;
}

export async function setSession(role: Role) {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  (await cookies()).set(COOKIE, `${role}.${expires}.${sign(role, expires)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentRole(): Promise<Role | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  if (!value) return null;
  const [role, exp, sig] = value.split(".");
  if (role !== "parent" && role !== "nanny") return null;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return null;
  return safeEqual(sig ?? "", sign(role, expires)) ? role : null;
}
