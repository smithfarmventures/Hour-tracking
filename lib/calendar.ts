// iCalendar (.ics) feed of approved days, for subscribing from Google Calendar,
// Outlook or Apple Calendar. Pure functions: the route in app/cal supplies state.

import { type State, addDays, describeShift, phaseOf, round2, shiftHours, workedShift } from "./model.ts";

/** Offset of `timeZone` from UTC, in minutes, at the instant `utcMs`. */
function tzOffsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - utcMs) / 60000);
}

/** UTC instant of wall-clock `date` + `time` ("HH:MM") in `timeZone`. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset on either side of a DST change.
  let utc = wall - tzOffsetMinutes(wall, timeZone) * 60000;
  utc = wall - tzOffsetMinutes(utc, timeZone) * 60000;
  return new Date(utc);
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const floatingStamp = (date: string, time: string) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Fold lines longer than 75 octets, as RFC 5545 requires. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

/**
 * Every approved working day of every sent week. Times use the family's time
 * zone when known (as UTC), otherwise "floating" local times, which calendars
 * show in the viewer's own zone.
 */
export function buildCalendar(state: State, opts: { appUrl: string; now: Date }): string {
  const { nannyName } = state.settings;
  const tz = state.settings.timeZone;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//James Journal//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:James Journal",
    `X-WR-CALDESC:${escapeText(`Approved hours for ${nannyName} with James`)}`,
    "X-PUBLISHED-TTL:PT1H",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const stamp = utcStamp(opts.now);

  const weeks = Object.values(state.weeks)
    .filter((w) => w.sentAt)
    .sort((a, b) => a.start.localeCompare(b.start));
  for (const week of weeks) {
    const signed = phaseOf(week) === "signed";
    for (const day of week.days) {
      const shift = workedShift(day);
      if (day.status !== "approved" || !shift) continue;
      const overnight = shiftHours(shift) > 0 && shift.end <= shift.start;
      const endDate = overnight ? addDays(day.date, 1) : day.date;
      const start = tz ? `DTSTART:${utcStamp(zonedToUtc(day.date, shift.start, tz))}` : `DTSTART:${floatingStamp(day.date, shift.start)}`;
      const end = tz ? `DTEND:${utcStamp(zonedToUtc(endDate, shift.end, tz))}` : `DTEND:${floatingStamp(endDate, shift.end)}`;

      const details = [`${describeShift(shift)} · ${round2(shiftHours(shift))} hrs`];
      if (day.worked) details.push(`Scheduled ${describeShift(day.shift)}; actual hours logged${day.worked.note ? `: ${day.worked.note}` : ""}`);
      details.push(signed ? "Signed off by both of you." : "Approved in James Journal.");
      details.push(opts.appUrl);

      lines.push(
        "BEGIN:VEVENT",
        `UID:${day.date}@james-journal`,
        `DTSTAMP:${stamp}`,
        start,
        end,
        `SUMMARY:${escapeText(`${nannyName} with James`)}`,
        `DESCRIPTION:${escapeText(details.join("\n"))}`,
        `URL:${opts.appUrl}`,
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
