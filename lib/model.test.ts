import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type Action,
  type Role,
  type State,
  ActionError,
  addDays,
  applyAction,
  initialState,
  mondayOf,
  phaseOf,
  shiftHours,
  signedWeeksCsv,
  weekTotals,
} from "./model.ts";

const WEEK = "2026-10-19"; // a Monday
const NOW = "2026-10-16T12:00:00.000Z";
const nineToFive = { start: "09:00", end: "17:00" };

function run(state: State, ...steps: [Role, Action][]): State {
  return steps.reduce((s, [role, action]) => applyAction(s, role, action, NOW), state);
}

function withTemplateWeek(): State {
  let s = initialState();
  s = run(
    s,
    ["parent", { type: "saveSettings", settings: { hourlyRate: 25, parentName: "Smiths", nannyName: "Amy" } }],
    [
      "parent",
      { type: "saveTemplate", template: [nineToFive, nineToFive, nineToFive, nineToFive, nineToFive, null, null] },
    ],
    ["parent", { type: "createWeek", week: WEEK, fromTemplate: true }],
  );
  return s;
}

test("date helpers", () => {
  assert.equal(mondayOf("2026-10-16"), "2026-10-12"); // Friday
  assert.equal(mondayOf("2026-10-18"), "2026-10-12"); // Sunday
  assert.equal(mondayOf("2026-10-19"), "2026-10-19");
  assert.equal(addDays("2026-12-29", 5), "2027-01-03");
});

test("shift hours, including overnight", () => {
  assert.equal(shiftHours(nineToFive), 8);
  assert.equal(shiftHours({ start: "08:30", end: "12:15" }), 3.75);
  assert.equal(shiftHours({ start: "18:00", end: "01:00" }), 7);
  assert.equal(shiftHours(null), 0);
});

test("full happy path: propose, approve, sign off, lock", () => {
  let s = withTemplateWeek();
  assert.equal(phaseOf(s.weeks[WEEK]), "draft");
  assert.equal(weekTotals(s.weeks[WEEK]).scheduledHours, 40);
  assert.equal(s.weeks[WEEK].rate, 25);

  s = run(s, ["parent", { type: "sendWeek", week: WEEK }]);
  assert.equal(phaseOf(s.weeks[WEEK]), "proposed");
  // Days off are approved automatically.
  assert.equal(s.weeks[WEEK].days[5].status, "approved");

  s = run(s, ["nanny", { type: "approveAll", week: WEEK }]);
  assert.equal(phaseOf(s.weeks[WEEK]), "confirmed");

  s = run(s, ["parent", { type: "signOff", week: WEEK }]);
  assert.equal(phaseOf(s.weeks[WEEK]), "confirmed");
  s = run(s, ["nanny", { type: "signOff", week: WEEK }]);
  assert.equal(phaseOf(s.weeks[WEEK]), "signed");
  assert.deepEqual(
    { hours: s.weeks[WEEK].signoffs.nanny!.hours, pay: s.weeks[WEEK].signoffs.nanny!.pay },
    { hours: 40, pay: 1000 },
  );

  assert.throws(
    () => run(s, ["parent", { type: "setShift", week: WEEK, date: WEEK, shift: null }]),
    /locked/,
  );
  assert.throws(() => run(s, ["nanny", { type: "setWorked", week: WEEK, date: WEEK, shift: null, note: "" }]), /locked/);
});

test("change request accepted by parent", () => {
  let s = run(withTemplateWeek(), ["parent", { type: "sendWeek", week: WEEK }]);
  const tue = addDays(WEEK, 1);
  s = run(s, [
    "nanny",
    { type: "requestChange", week: WEEK, date: tue, shift: { start: "10:00", end: "17:00" }, note: "dentist" },
  ]);
  assert.equal(s.weeks[WEEK].days[1].status, "change_requested");
  s = run(s, ["parent", { type: "acceptRequest", week: WEEK, date: tue }]);
  assert.deepEqual(s.weeks[WEEK].days[1].shift, { start: "10:00", end: "17:00" });
  assert.equal(s.weeks[WEEK].days[1].status, "approved");
  s = run(s, ["nanny", { type: "approveAll", week: WEEK }]);
  assert.equal(weekTotals(s.weeks[WEEK]).scheduledHours, 39);
});

test("declined request goes back to the nanny to re-confirm", () => {
  let s = run(withTemplateWeek(), ["parent", { type: "sendWeek", week: WEEK }]);
  s = run(
    s,
    ["nanny", { type: "requestChange", week: WEEK, date: WEEK, shift: null, note: "" }],
    ["parent", { type: "declineRequest", week: WEEK, date: WEEK }],
  );
  assert.equal(s.weeks[WEEK].days[0].status, "pending");
  assert.deepEqual(s.weeks[WEEK].days[0].shift, nineToFive);
});

test("parent editing a sent day requires re-approval", () => {
  let s = run(
    withTemplateWeek(),
    ["parent", { type: "sendWeek", week: WEEK }],
    ["nanny", { type: "approveAll", week: WEEK }],
    ["parent", { type: "setShift", week: WEEK, date: WEEK, shift: { start: "08:00", end: "17:00" } }],
  );
  assert.equal(phaseOf(s.weeks[WEEK]), "proposed");
  assert.equal(s.weeks[WEEK].days[0].status, "pending");
});

test("logging actual hours changes totals and clears sign-offs", () => {
  let s = run(
    withTemplateWeek(),
    ["parent", { type: "sendWeek", week: WEEK }],
    ["nanny", { type: "approveAll", week: WEEK }],
    ["parent", { type: "signOff", week: WEEK }],
  );
  assert.ok(s.weeks[WEEK].signoffs.parent);
  s = run(s, [
    "nanny",
    { type: "setWorked", week: WEEK, date: WEEK, shift: { start: "09:00", end: "18:30" }, note: "stayed late" },
  ]);
  assert.equal(s.weeks[WEEK].signoffs.parent, null);
  assert.deepEqual(weekTotals(s.weeks[WEEK]), { scheduledHours: 40, hours: 41.5, pay: 1037.5 });
  s = run(s, ["parent", { type: "clearWorked", week: WEEK, date: WEEK }]);
  assert.equal(weekTotals(s.weeks[WEEK]).hours, 40);
});

test("permissions and guards", () => {
  const s = withTemplateWeek();
  const expectErr = (role: Role, action: Action, re: RegExp) =>
    assert.throws(() => applyAction(s, role, action, NOW), (e: unknown) => e instanceof ActionError && re.test(e.message));
  expectErr("nanny", { type: "createWeek", week: "2026-10-26", fromTemplate: false }, /Only the parents/);
  expectErr("parent", { type: "createWeek", week: "2026-10-20", fromTemplate: false }, /Monday/);
  expectErr("parent", { type: "createWeek", week: WEEK, fromTemplate: false }, /already exists/);
  expectErr("nanny", { type: "approveAll", week: WEEK }, /hasn't been sent/);
  expectErr("parent", { type: "approveAll", week: WEEK }, /Only the nanny/);
  expectErr("parent", { type: "signOff", week: WEEK }, /approved/);
  expectErr("parent", { type: "setShift", week: WEEK, date: WEEK, shift: { start: "9:00", end: "17:00" } }, /HH:MM/);
  expectErr("parent", { type: "setShift", week: WEEK, date: "2026-11-01", shift: null }, /isn't in this week/);
  expectErr("parent", { type: "setRate", week: WEEK, rate: -1 }, /Rate/);
});

test("applyAction does not mutate its input", () => {
  const s = withTemplateWeek();
  const before = JSON.stringify(s);
  applyAction(s, "parent", { type: "sendWeek", week: WEEK }, NOW);
  assert.equal(JSON.stringify(s), before);
});

test("CSV export includes only signed weeks", () => {
  let s = withTemplateWeek();
  assert.equal(signedWeeksCsv(s).trim().split("\n").length, 1);
  s = run(
    s,
    ["parent", { type: "sendWeek", week: WEEK }],
    ["nanny", { type: "approveAll", week: WEEK }],
    ["parent", { type: "signOff", week: WEEK }],
    ["nanny", { type: "signOff", week: WEEK }],
  );
  const lines = signedWeeksCsv(s).trim().split("\n");
  assert.equal(lines.length, 1 + 7 + 1);
  assert.match(lines[1], /^2026-10-19,2026-10-19,Mon,9am–5pm,09:00,17:00,8,25.00,200.00,/);
  assert.match(lines[8], /TOTAL,,,,40,25.00,1000.00/);
});
