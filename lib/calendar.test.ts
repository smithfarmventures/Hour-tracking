import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, zonedToUtc } from "./calendar.ts";
import { type Action, type Role, type State, applyAction, initialState } from "./model.ts";

const NOW = "2026-10-16T12:00:00.000Z";
const WEEK = "2026-10-19";
const nineToFive = { start: "09:00", end: "17:00" };

function run(state: State, ...steps: [Role, Action][]): State {
  return steps.reduce((s, [role, action]) => applyAction(s, role, action, NOW), state);
}

const opts = { appUrl: "https://example.test/", now: new Date(NOW) };

test("zonedToUtc handles Israel's switch from summer to winter time", () => {
  // Israel daylight time ends Sunday 25 Oct 2026.
  assert.equal(zonedToUtc("2026-10-19", "09:00", "Asia/Jerusalem").toISOString(), "2026-10-19T06:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-26", "09:00", "Asia/Jerusalem").toISOString(), "2026-10-26T07:00:00.000Z");
  assert.equal(zonedToUtc("2026-07-01", "09:00", "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z");
});

test("feed has only approved working days of sent weeks, using actual hours", () => {
  let s = run(
    initialState(),
    ["parent", { type: "setTimeZone", timeZone: "Asia/Jerusalem" }],
    ["parent", { type: "saveTemplate", template: [nineToFive, nineToFive, { start: "20:00", end: "01:00" }, null, null, null, null] }],
    ["parent", { type: "createWeek", week: WEEK, fromTemplate: true }],
    ["parent", { type: "createWeek", week: "2026-10-26", fromTemplate: true }], // draft: never in the feed
  );
  assert.doesNotMatch(buildCalendar(s, opts), /BEGIN:VEVENT/);

  s = run(
    s,
    ["parent", { type: "sendWeek", week: WEEK }],
    ["nanny", { type: "approveDay", week: WEEK, date: WEEK }],
    ["nanny", { type: "approveDay", week: WEEK, date: "2026-10-21" }],
  );
  let ics = buildCalendar(s, opts);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2, "Tuesday is still pending");
  assert.match(ics, /UID:2026-10-19@james-journal\r\nDTSTAMP:20261016T120000Z\r\nDTSTART:20261019T060000Z\r\nDTEND:20261019T140000Z/);
  // Overnight shift ends the next morning.
  assert.match(ics, /DTSTART:20261021T170000Z\r\nDTEND:20261021T220000Z/);
  assert.match(ics, /SUMMARY:Amy with James/);
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));

  s = run(
    s,
    ["nanny", { type: "approveAll", week: WEEK }],
    ["nanny", { type: "setWorked", week: WEEK, date: WEEK, shift: { start: "09:00", end: "18:30" }, note: "late pickup; traffic" }],
  );
  ics = buildCalendar(s, opts);
  assert.match(ics, /DTSTART:20261019T060000Z\r\nDTEND:20261019T153000Z/);
  assert.match(ics.replace(/\r\n /g, ""), /late pickup\\; traffic/, "text is escaped (after unfolding)");
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
});

test("without a time zone, times are floating local times", () => {
  const s = run(
    initialState(),
    ["parent", { type: "saveTemplate", template: [nineToFive, null, null, null, null, null, null] }],
    ["parent", { type: "createWeek", week: WEEK, fromTemplate: true }],
    ["parent", { type: "sendWeek", week: WEEK }],
    ["nanny", { type: "approveAll", week: WEEK }],
  );
  assert.match(buildCalendar(s, opts), /DTSTART:20261019T090000\r\nDTEND:20261019T170000\r\n/);
});
