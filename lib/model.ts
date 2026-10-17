// Core data model and business rules. Pure functions only: no I/O, so the
// server can apply actions to a loaded state and the rules can be unit tested.

export type Role = "parent" | "nanny";

/** A block of time on one day, "HH:MM" 24h. An end at or before the start runs past midnight. */
export type Shift = { start: string; end: string };

export type DayStatus = "pending" | "approved" | "change_requested";

export type ChangeRequest = { shift: Shift | null; note: string; at: string };

export type WorkedOverride = { shift: Shift | null; note: string; by: Role; at: string };

export type Day = {
  date: string; // YYYY-MM-DD
  shift: Shift | null; // scheduled hours; null = day off
  status: DayStatus;
  request: ChangeRequest | null; // nanny's requested change, while status is change_requested
  worked: WorkedOverride | null; // actual hours when they differed from the schedule
};

export type Signoff = { at: string; hours: number; pay: number; currency?: string };

export type LogEntry = { at: string; by: Role; text: string };

export type Week = {
  start: string; // Monday, YYYY-MM-DD
  rate: number; // hourly rate for this week
  currency?: string; // ISO code; unset on weeks created before currencies existed
  sentAt: string | null; // when the parent sent the proposal
  days: Day[]; // always 7, Monday first
  signoffs: { parent: Signoff | null; nanny: Signoff | null };
  log: LogEntry[];
};

export type Settings = { hourlyRate: number; currency?: string; parentName: string; nannyName: string };

export const CURRENCIES = [
  { code: "ILS", label: "Israeli shekel (₪)" },
  { code: "USD", label: "US dollar ($)" },
  { code: "EUR", label: "Euro (€)" },
  { code: "GBP", label: "British pound (£)" },
  { code: "CAD", label: "Canadian dollar (CA$)" },
  { code: "AUD", label: "Australian dollar (A$)" },
] as const;

export const DEFAULT_CURRENCY = "USD";

/** The currency a week is paid in: its own once set, else the current setting. */
export function currencyOf(state: Pick<State, "settings">, week?: Week): string {
  return week?.currency ?? state.settings.currency ?? DEFAULT_CURRENCY;
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export type State = {
  version: 1;
  /** Secret link keys. Never sent to the browser; see lib/api.ts viewFor. */
  access?: { parentKey: string; nannyKey: string };
  settings: Settings;
  template: (Shift | null)[]; // 7 entries, Monday first
  weeks: Record<string, Week>;
};

export type Phase = "draft" | "proposed" | "confirmed" | "signed";

export type Action =
  | { type: "createWeek"; week: string; fromTemplate: boolean }
  | { type: "deleteWeek"; week: string }
  | { type: "setShift"; week: string; date: string; shift: Shift | null }
  | { type: "sendWeek"; week: string }
  | { type: "approveDay"; week: string; date: string }
  | { type: "approveAll"; week: string }
  | { type: "requestChange"; week: string; date: string; shift: Shift | null; note: string }
  | { type: "acceptRequest"; week: string; date: string }
  | { type: "declineRequest"; week: string; date: string }
  | { type: "setWorked"; week: string; date: string; shift: Shift | null; note: string }
  | { type: "clearWorked"; week: string; date: string }
  | { type: "setRate"; week: string; rate: number }
  | { type: "signOff"; week: string }
  | { type: "saveTemplate"; template: (Shift | null)[] }
  | { type: "saveSettings"; settings: Settings };

export class ActionError extends Error {}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function initialState(): State {
  return {
    version: 1,
    settings: { hourlyRate: 0, parentName: "Parents", nannyName: "Amy" },
    template: [null, null, null, null, null, null, null],
    weeks: {},
  };
}

// ---------- dates ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseDate(iso: string): Date {
  if (!DATE_RE.test(iso)) throw new ActionError(`Invalid date: ${iso}`);
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) {
    throw new ActionError(`Invalid date: ${iso}`);
  }
  return d;
}

export function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before the given date. */
export function mondayOf(iso: string): string {
  const dow = (parseDate(iso).getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
  return addDays(iso, -dow);
}

// ---------- hours & pay ----------

function minutesOf(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function shiftHours(shift: Shift | null): number {
  if (!shift) return 0;
  let mins = minutesOf(shift.end) - minutesOf(shift.start);
  if (mins <= 0) mins += 24 * 60; // runs past midnight
  return mins / 60;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The hours that count for pay: the logged actual if any, else the schedule. */
export function workedShift(day: Day): Shift | null {
  return day.worked ? day.worked.shift : day.shift;
}

export function weekTotals(week: Week): { scheduledHours: number; hours: number; pay: number } {
  let scheduled = 0;
  let worked = 0;
  for (const d of week.days) {
    scheduled += shiftHours(d.shift);
    worked += shiftHours(workedShift(d));
  }
  const hours = round2(worked);
  return { scheduledHours: round2(scheduled), hours, pay: round2(hours * week.rate) };
}

export function phaseOf(week: Week): Phase {
  if (week.signoffs.parent && week.signoffs.nanny) return "signed";
  if (!week.sentAt) return "draft";
  return week.days.every((d) => d.status === "approved") ? "confirmed" : "proposed";
}

// ---------- validation ----------

function checkShift(shift: unknown): Shift | null {
  if (shift === null) return null;
  const s = shift as Shift;
  if (!s || typeof s !== "object" || !TIME_RE.test(s.start) || !TIME_RE.test(s.end)) {
    throw new ActionError("Times must be HH:MM");
  }
  if (s.start === s.end) throw new ActionError("Start and end can't be the same time");
  return { start: s.start, end: s.end };
}

function checkNote(note: unknown): string {
  if (note === undefined || note === null) return "";
  if (typeof note !== "string") throw new ActionError("Invalid note");
  return note.trim().slice(0, 500);
}

function checkCurrency(code: unknown): string {
  if (!CURRENCIES.some((c) => c.code === code)) throw new ActionError("Unsupported currency");
  return code as string;
}

function checkRate(rate: unknown): number {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 10000) {
    throw new ActionError("Rate must be a number between 0 and 10,000");
  }
  return round2(rate);
}

function checkName(name: unknown, fallback: string): string {
  if (typeof name !== "string") return fallback;
  return name.trim().slice(0, 40) || fallback;
}

// ---------- describing changes ----------

function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

export function describeShift(shift: Shift | null): string {
  return shift ? `${fmtTime(shift.start)}–${fmtTime(shift.end)}` : "off";
}

function dayLabel(week: Week, date: string): string {
  return WEEKDAYS[week.days.findIndex((d) => d.date === date)];
}

// ---------- applying actions ----------

function requireRole(role: Role, needed: Role) {
  if (role !== needed) {
    throw new ActionError(needed === "parent" ? "Only the parents can do that" : "Only the nanny can do that");
  }
}

function getWeek(state: State, start: string): Week {
  const week = state.weeks[start];
  if (!week) throw new ActionError("That week doesn't exist yet");
  return week;
}

function getDay(week: Week, date: string): Day {
  const day = week.days.find((d) => d.date === date);
  if (!day) throw new ActionError("That date isn't in this week");
  return day;
}

function requireUnsigned(week: Week) {
  if (phaseOf(week) === "signed") throw new ActionError("This week is signed off and locked");
}

/** Any change to the hours invalidates signatures collected so far. */
function clearSignoffs(week: Week, now: string, by: Role) {
  if (week.signoffs.parent || week.signoffs.nanny) {
    week.signoffs = { parent: null, nanny: null };
    week.log.push({ at: now, by, text: "Sign-offs cleared because the hours changed" });
  }
}

/**
 * Apply an action by `role` to `state`, returning a new state. Throws ActionError
 * when the action isn't allowed. `now` is an ISO timestamp.
 */
export function applyAction(prev: State, role: Role, action: Action, now: string): State {
  const state: State = structuredClone(prev);
  const log = (week: Week, text: string) => week.log.push({ at: now, by: role, text });

  switch (action.type) {
    case "createWeek": {
      requireRole(role, "parent");
      const start = action.week;
      if (mondayOf(start) !== start) throw new ActionError("Weeks start on Monday");
      if (state.weeks[start]) throw new ActionError("That week already exists");
      const week: Week = {
        start,
        rate: state.settings.hourlyRate,
        currency: currencyOf(state),
        sentAt: null,
        days: Array.from({ length: 7 }, (_, i) => ({
          date: addDays(start, i),
          shift: action.fromTemplate ? state.template[i] ?? null : null,
          status: "pending" as DayStatus,
          request: null,
          worked: null,
        })),
        signoffs: { parent: null, nanny: null },
        log: [],
      };
      log(week, action.fromTemplate ? "Created the week from the default schedule" : "Created the week");
      state.weeks[start] = week;
      return state;
    }

    case "deleteWeek": {
      requireRole(role, "parent");
      const week = getWeek(state, action.week);
      if (phaseOf(week) !== "draft") throw new ActionError("Only unsent drafts can be deleted");
      delete state.weeks[action.week];
      return state;
    }

    case "setShift": {
      requireRole(role, "parent");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      const day = getDay(week, action.date);
      day.shift = checkShift(action.shift);
      day.request = null;
      if (week.sentAt) {
        // Changes after sending need the nanny's OK again.
        day.status = "pending";
        log(week, `Changed ${dayLabel(week, day.date)} to ${describeShift(day.shift)}`);
        clearSignoffs(week, now, role);
      }
      return state;
    }

    case "sendWeek": {
      requireRole(role, "parent");
      const week = getWeek(state, action.week);
      if (week.sentAt) throw new ActionError("Already sent");
      week.sentAt = now;
      for (const d of week.days) d.status = d.shift ? "pending" : "approved";
      log(week, `Sent the proposed schedule (${weekTotals(week).scheduledHours} hrs)`);
      return state;
    }

    case "approveDay": {
      requireRole(role, "nanny");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      if (!week.sentAt) throw new ActionError("This week hasn't been sent yet");
      const day = getDay(week, action.date);
      day.status = "approved";
      day.request = null;
      log(week, `Approved ${dayLabel(week, day.date)} (${describeShift(day.shift)})`);
      return state;
    }

    case "approveAll": {
      requireRole(role, "nanny");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      if (!week.sentAt) throw new ActionError("This week hasn't been sent yet");
      const pending = week.days.filter((d) => d.status === "pending");
      if (pending.length === 0) throw new ActionError("Nothing left to approve");
      for (const d of pending) d.status = "approved";
      log(week, `Approved ${pending.map((d) => dayLabel(week, d.date)).join(", ")}`);
      return state;
    }

    case "requestChange": {
      requireRole(role, "nanny");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      if (!week.sentAt) throw new ActionError("This week hasn't been sent yet");
      const day = getDay(week, action.date);
      const shift = checkShift(action.shift);
      const note = checkNote(action.note);
      day.status = "change_requested";
      day.request = { shift, note, at: now };
      log(
        week,
        `Requested ${dayLabel(week, day.date)} change to ${describeShift(shift)}` + (note ? ` — “${note}”` : ""),
      );
      clearSignoffs(week, now, role);
      return state;
    }

    case "acceptRequest": {
      requireRole(role, "parent");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      const day = getDay(week, action.date);
      if (day.status !== "change_requested" || !day.request) throw new ActionError("No change request on that day");
      day.shift = day.request.shift;
      day.request = null;
      day.status = "approved";
      log(week, `Accepted change: ${dayLabel(week, day.date)} is now ${describeShift(day.shift)}`);
      return state;
    }

    case "declineRequest": {
      requireRole(role, "parent");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      const day = getDay(week, action.date);
      if (day.status !== "change_requested") throw new ActionError("No change request on that day");
      day.request = null;
      day.status = "pending";
      log(week, `Kept ${dayLabel(week, day.date)} as ${describeShift(day.shift)} (asked to re-confirm)`);
      return state;
    }

    case "setWorked": {
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      if (phaseOf(week) !== "confirmed") throw new ActionError("Confirm the schedule before logging hours");
      const day = getDay(week, action.date);
      const shift = checkShift(action.shift);
      const note = checkNote(action.note);
      day.worked = { shift, note, by: role, at: now };
      log(
        week,
        `Logged ${dayLabel(week, day.date)} as actually worked ${describeShift(shift)}` + (note ? ` — “${note}”` : ""),
      );
      clearSignoffs(week, now, role);
      return state;
    }

    case "clearWorked": {
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      const day = getDay(week, action.date);
      if (!day.worked) throw new ActionError("Nothing to reset");
      day.worked = null;
      log(week, `Reset ${dayLabel(week, day.date)} back to the scheduled ${describeShift(day.shift)}`);
      clearSignoffs(week, now, role);
      return state;
    }

    case "setRate": {
      requireRole(role, "parent");
      const week = getWeek(state, action.week);
      requireUnsigned(week);
      const rate = checkRate(action.rate);
      if (rate === week.rate) return state;
      week.rate = rate;
      log(week, `Set the rate to ${formatMoney(rate, currencyOf(state, week))}/hr`);
      clearSignoffs(week, now, role);
      return state;
    }

    case "signOff": {
      const week = getWeek(state, action.week);
      const phase = phaseOf(week);
      if (phase === "signed") throw new ActionError("Already signed off");
      if (phase !== "confirmed") throw new ActionError("Every day must be approved before signing off");
      if (week.signoffs[role]) throw new ActionError("You've already signed off");
      const { hours, pay } = weekTotals(week);
      const currency = currencyOf(state, week);
      week.currency = currency; // freeze what this signature is for
      week.signoffs[role] = { at: now, hours, pay, currency };
      log(week, `Signed off on ${hours} hrs (${formatMoney(pay, currency)})`);
      return state;
    }

    case "saveTemplate": {
      requireRole(role, "parent");
      if (!Array.isArray(action.template) || action.template.length !== 7) {
        throw new ActionError("Template needs 7 days");
      }
      state.template = action.template.map(checkShift);
      return state;
    }

    case "saveSettings": {
      requireRole(role, "parent");
      const s = action.settings ?? ({} as Settings);
      const prevRate = state.settings.hourlyRate;
      const next: Settings = {
        hourlyRate: checkRate(s.hourlyRate),
        currency: checkCurrency(s.currency ?? currencyOf(state)),
        parentName: checkName(s.parentName, state.settings.parentName),
        nannyName: checkName(s.nannyName, state.settings.nannyName),
      };
      state.settings = next;
      // Weeks still in progress follow the new pay terms; signed weeks never change.
      for (const week of Object.values(state.weeks)) {
        if (phaseOf(week) === "signed") continue;
        let changed = false;
        if (currencyOf(state, week) !== next.currency) {
          week.currency = next.currency;
          log(week, `Changed the currency to ${next.currency}`);
          changed = true;
        }
        if (next.hourlyRate !== prevRate && week.rate === prevRate) {
          week.rate = next.hourlyRate;
          log(week, `Set the rate to ${formatMoney(week.rate, next.currency!)}/hr`);
          changed = true;
        }
        if (changed) clearSignoffs(week, now, role);
      }
      return state;
    }

    default:
      throw new ActionError("Unknown action");
  }
}

// ---------- export ----------

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per day of every fully signed week, oldest first. */
export function signedWeeksCsv(state: State): string {
  const header = [
    "Week of",
    "Date",
    "Day",
    "Scheduled",
    "Worked start",
    "Worked end",
    "Hours",
    "Currency",
    "Rate",
    "Pay",
    "Note",
    `${state.settings.parentName} signed`,
    `${state.settings.nannyName} signed`,
  ];
  const rows: (string | number)[][] = [header];
  const weeks = Object.values(state.weeks)
    .filter((w) => phaseOf(w) === "signed")
    .sort((a, b) => a.start.localeCompare(b.start));
  for (const w of weeks) {
    w.days.forEach((d, i) => {
      const shift = workedShift(d);
      const hours = round2(shiftHours(shift));
      rows.push([
        w.start,
        d.date,
        WEEKDAYS[i],
        describeShift(d.shift),
        shift?.start ?? "",
        shift?.end ?? "",
        hours,
        currencyOf(state, w),
        w.rate.toFixed(2),
        (hours * w.rate).toFixed(2),
        d.worked?.note ?? "",
        w.signoffs.parent!.at,
        w.signoffs.nanny!.at,
      ]);
    });
    const t = weekTotals(w);
    rows.push([w.start, "", "TOTAL", "", "", "", t.hours, currencyOf(state, w), w.rate.toFixed(2), t.pay.toFixed(2), "", "", ""]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
