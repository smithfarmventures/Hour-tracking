// Link-based access for exactly two roles, with nothing to type. Each role has
// a secret key stored in the app state; opening /join/<key> once stores that key
// in a long-lived httpOnly cookie on the device. Resetting the keys revokes
// every device and every link that was shared.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role, State } from "./model";

export const COOKIE = "nh_access";
const MAX_AGE_S = 60 * 60 * 24 * 400; // browsers cap cookies at ~400 days

export function newKeys(): NonNullable<State["access"]> {
  const key = () => randomBytes(24).toString("base64url");
  return { parentKey: key(), nannyKey: key(), calendarKey: key() };
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function roleForKey(state: State, key: string | undefined): Role | null {
  if (!key || !state.access) return null;
  const isParent = safeEqual(key, state.access.parentKey);
  const isNanny = safeEqual(key, state.access.nannyKey);
  return isParent ? "parent" : isNanny ? "nanny" : null;
}

export async function setAccessCookie(key: string) {
  (await cookies()).set(COOKIE, key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function roleFromCookie(state: State): Promise<Role | null> {
  return roleForKey(state, (await cookies()).get(COOKIE)?.value);
}
