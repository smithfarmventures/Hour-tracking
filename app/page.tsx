"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Action,
  type Day,
  type Role,
  type Shift,
  type State,
  type Week,
  CURRENCIES,
  WEEKDAYS,
  currencyOf,
  formatMoney,
  addDays,
  describeShift,
  mondayOf,
  phaseOf,
  round2,
  shiftHours,
  weekTotals,
  workedShift,
} from "@/lib/model";

type Tab = "week" | "history" | "settings" | "calendar";

// ---------- formatting ----------

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
}

function fmtWeek(start: string) {
  return `${fmtDate(start, { month: "short", day: "numeric" })} – ${fmtDate(addDays(start, 6), { month: "short", day: "numeric" })}`;
}

function fmtStamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const money = (n: number, currency: string) => formatMoney(n, currency);
const hrs = (n: number) => `${round2(n)} hr${n === 1 ? "" : "s"}`;

// ---------- data hook ----------

function useAppState() {
  const [role, setRole] = useState<Role | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<{ setupNeeded: boolean; storageError: string | null }>({
    setupNeeded: false,
    storageError: null,
  });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        setRole(body.role);
        setState(body.state);
        setGate({ setupNeeded: false, storageError: null });
      } else if (res.status === 401 || res.status === 503) {
        setRole(null);
        setState(null);
        setGate({ setupNeeded: Boolean(body.setupNeeded), storageError: body.storageMissing ? body.error : null });
      }
    } catch {
      // Offline: keep showing what we have.
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => document.visibilityState === "visible" && refresh();
    const timer = setInterval(onFocus, 20000);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const act = useCallback(async (action: Action): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Something went wrong");
        if (res.status === 401) setRole(null);
        return false;
      }
      setState(body.state);
      return true;
    } catch {
      setError("Couldn't reach the server. Check your connection.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { role, state, loading, error, setError, busy, act, refresh, gate };
}

// ---------- page ----------

export default function Page() {
  const app = useAppState();
  const [tab, setTab] = useState<Tab>("week");
  const [week, setWeek] = useState(() => mondayOf(localToday()));
  const [hello, setHello] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("welcome")) setHello(true);
  }, []);

  // Calendar times need the family's time zone: take it from the parent's device once.
  const needsTimeZone = app.role === "parent" && app.state !== null && !app.state.settings.timeZone;
  useEffect(() => {
    if (!needsTimeZone) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) app.act({ type: "setTimeZone", timeZone });
  }, [needsTimeZone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (app.loading) return <main className="center muted">Loading…</main>;
  if (!app.role || !app.state) return <Welcome gate={app.gate} onDone={app.refresh} />;

  const { role, state } = app;
  const me = role === "parent" ? state.settings.parentName : state.settings.nannyName;

  if (hello && role === "nanny") {
    return (
      <Hello
        state={state}
        onDone={() => {
          window.history.replaceState(null, "", "/");
          setHello(false);
        }}
      />
    );
  }

  return (
    <main>
      <header className="top">
        <div>
          <h1>James Journal</h1>
          <div className="muted small">Hi, {me}!</div>
        </div>
        <button className={tab === "calendar" ? "primary" : ""} onClick={() => setTab(tab === "calendar" ? "week" : "calendar")}>
          📅 Calendar
        </button>
      </header>

      <nav className="tabs">
        <button className={tab === "week" ? "on" : ""} onClick={() => setTab("week")}>
          Week
        </button>
        <button className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>
          History
        </button>
        {role === "parent" && (
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            Settings
          </button>
        )}
      </nav>

      {app.error && (
        <div className="banner error" onClick={() => app.setError(null)}>
          {app.error} <span className="muted small">(tap to dismiss)</span>
        </div>
      )}

      {tab === "week" && <WeekView role={role} state={state} start={week} setStart={setWeek} act={app.act} busy={app.busy} />}
      {tab === "history" && (
        <History
          state={state}
          open={(w) => {
            setWeek(w);
            setTab("week");
          }}
        />
      )}
      {tab === "settings" && role === "parent" && <SettingsView state={state} act={app.act} busy={app.busy} />}
      {tab === "calendar" && <CalendarView state={state} />}
    </main>
  );
}

// ---------- hello (nanny's first visit from their link) ----------

function Hello({ state, onDone }: { state: State; onDone: () => void }) {
  const { nannyName } = state.settings;
  return (
    <main className="center">
      <div className="card login hello">
        <p className="hello-wave">👋</p>
        <h1>Hi {nannyName}, welcome to James Journal!</h1>
        <p>
          This is our little shared spot to line up your hours with James each week, so we can all focus more on James and
          less on journaling.
        </p>
        <ul className="hello-steps">
          <li>
            <span>📅</span>
            <span>Each week we&apos;ll send over the schedule. Tap ✓ if it works, or suggest a change.</span>
          </li>
          <li>
            <span>✏️</span>
            <span>If a day runs long or short, just jot it down.</span>
          </li>
          <li>
            <span>🤝</span>
            <span>At the end of the week, we both tap Sign off, and payday is sorted.</span>
          </li>
        </ul>
        <p className="muted small">You&apos;re all set on this phone. No passwords, ever.</p>
        <button className="primary" onClick={onDone}>
          Let&apos;s go!
        </button>
      </div>
    </main>
  );
}

// ---------- welcome (not signed in on this device) ----------

function Welcome({
  gate,
  onDone,
}: {
  gate: { setupNeeded: boolean; storageError: string | null };
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const badLink = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("link") === "invalid";

  async function setup() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/setup", { method: "POST" });
    setBusy(false);
    if (res.ok) {
      window.history.replaceState(null, "", "/");
      onDone();
    } else setError((await res.json().catch(() => ({}))).error ?? "Setup failed");
  }

  return (
    <main className="center">
      <div className="card login">
        <h1>James Journal</h1>
        {gate.storageError ? (
          <p className="error-text">{gate.storageError}</p>
        ) : gate.setupNeeded ? (
          <>
            <p>Welcome! Tap below to make this the parents&apos; device.</p>
            <p className="muted small">
              You&apos;ll stay signed in here. Then head to Settings to send your nanny their personal link. One tap and
              they&apos;re in.
            </p>
            {error && <div className="error-text">{error}</div>}
            <button className="primary" disabled={busy} onClick={setup}>
              {busy ? "Setting up…" : "Set up on this device"}
            </button>
          </>
        ) : (
          <>
            <p className="hello-wave">👋</p>
            {badLink ? (
              <>
                <p>Hmm, that link has been swapped for a newer one.</p>
                <p className="muted small">Ask the family for the latest link and you&apos;ll be all set in one tap.</p>
              </>
            ) : (
              <>
                <p>Hi there!</p>
                <p className="muted small">To open James Journal, just tap the personal link the family sent you.</p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

// ---------- week ----------

type ActFn = (a: Action) => Promise<boolean>;

function WeekView({
  role,
  state,
  start,
  setStart,
  act,
  busy,
}: {
  role: Role;
  state: State;
  start: string;
  setStart: (s: string) => void;
  act: ActFn;
  busy: boolean;
}) {
  const week = state.weeks[start];
  const thisWeek = mondayOf(localToday());
  const relative = start === thisWeek ? "This week" : start === addDays(thisWeek, 7) ? "Next week" : start === addDays(thisWeek, -7) ? "Last week" : null;

  return (
    <section>
      <div className="weeknav">
        <button onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">
          ‹
        </button>
        <div className="weektitle">
          <strong>{fmtWeek(start)}</strong>
          <div className="muted small">{relative ?? fmtDate(start, { year: "numeric" })}</div>
        </div>
        <button onClick={() => setStart(addDays(start, 7))} aria-label="Next week">
          ›
        </button>
      </div>
      {start !== thisWeek && (
        <div className="centertext">
          <button className="link small" onClick={() => setStart(thisWeek)}>
            Jump to this week
          </button>
        </div>
      )}

      {!week ? (
        <EmptyWeek role={role} state={state} start={start} act={act} busy={busy} />
      ) : (
        <WeekDetail role={role} state={state} week={week} act={act} busy={busy} />
      )}
    </section>
  );
}

function EmptyWeek({ role, state, start, act, busy }: { role: Role; state: State; start: string; act: ActFn; busy: boolean }) {
  if (role === "nanny") {
    return <div className="card muted centertext">The schedule for this week hasn't been sent yet.</div>;
  }
  const hasTemplate = state.template.some(Boolean);
  return (
    <div className="card centertext">
      <p>No schedule for this week yet.</p>
      <div className="row center-row">
        {hasTemplate && (
          <button className="primary" disabled={busy} onClick={() => act({ type: "createWeek", week: start, fromTemplate: true })}>
            Start from default schedule
          </button>
        )}
        <button disabled={busy} onClick={() => act({ type: "createWeek", week: start, fromTemplate: false })}>
          Start blank
        </button>
      </div>
      {!hasTemplate && <p className="muted small">Tip: set a default weekly schedule in Settings to fill weeks in one tap.</p>}
    </div>
  );
}

function StatusBanner({ role, state, week }: { role: Role; state: State; week: Week }) {
  const phase = phaseOf(week);
  const nanny = state.settings.nannyName;
  const parent = state.settings.parentName;
  const requests = week.days.filter((d) => d.status === "change_requested").length;
  const pending = week.days.filter((d) => d.status === "pending").length;

  let tone = "info";
  let text = "";
  if (phase === "draft") {
    text = `Draft — only you can see this. Set the hours, then send it to ${nanny}.`;
  } else if (phase === "proposed") {
    tone = "warn";
    if (role === "parent") {
      text = requests
        ? `${nanny} requested ${requests} change${requests > 1 ? "s" : ""}. Review below.`
        : `Waiting for ${nanny} to approve ${pending} day${pending === 1 ? "" : "s"}.`;
    } else {
      text = pending
        ? `Please review: ${pending} day${pending === 1 ? "" : "s"} need${pending === 1 ? "s" : ""} your approval.`
        : `Waiting for ${parent} to respond to your change request.`;
    }
  } else if (phase === "confirmed") {
    tone = "ok";
    const mine = week.signoffs[role];
    const other = week.signoffs[role === "parent" ? "nanny" : "parent"];
    text = mine
      ? `Schedule agreed. You've signed off — waiting for ${role === "parent" ? nanny : parent}.`
      : other
        ? `${role === "parent" ? nanny : parent} has signed off. Review the hours and sign below.`
        : "Schedule agreed. Log any days that went differently, then both sign off at the end of the week.";
  } else {
    tone = "done";
    text = "Signed off by both sides. This week is locked.";
  }
  return <div className={`banner ${tone}`}>{text}</div>;
}

function WeekDetail({ role, state, week, act, busy }: { role: Role; state: State; week: Week; act: ActFn; busy: boolean }) {
  const phase = phaseOf(week);
  const totals = weekTotals(week);
  const pending = week.days.filter((d) => d.status === "pending").length;

  return (
    <>
      <StatusBanner role={role} state={state} week={week} />

      {role === "nanny" && phase === "proposed" && pending > 1 && (
        <button className="primary block" disabled={busy} onClick={() => act({ type: "approveAll", week: week.start })}>
          Approve all {pending} remaining days
        </button>
      )}

      <div className="days">
        {week.days.map((d, i) => (
          <DayRow key={d.date} role={role} state={state} week={week} day={d} index={i} act={act} busy={busy} />
        ))}
      </div>

      <Totals role={role} week={week} currency={currencyOf(state, week)} totals={totals} act={act} busy={busy} />

      {phase === "draft" && role === "parent" && (
        <div className="row">
          <button
            className="primary grow"
            disabled={busy || totals.scheduledHours === 0}
            onClick={() => act({ type: "sendWeek", week: week.start })}
          >
            Send to {state.settings.nannyName} ({hrs(totals.scheduledHours)})
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => confirm("Delete this draft week?") && act({ type: "deleteWeek", week: week.start })}
          >
            Delete
          </button>
        </div>
      )}

      {(phase === "confirmed" || phase === "signed") && (
        <SignOff role={role} state={state} week={week} totals={totals} act={act} busy={busy} />
      )}

      {week.log.length > 0 && (
        <details className="log">
          <summary>Activity ({week.log.length})</summary>
          <ul>
            {[...week.log].reverse().map((e, i) => (
              <li key={i}>
                <span className="muted small">{fmtStamp(e.at)}</span>{" "}
                <strong>{e.by === "parent" ? state.settings.parentName : state.settings.nannyName}</strong> {e.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function StatusChip({ day, state }: { day: Day; state: State }) {
  if (day.status === "approved") return <span className="chip ok">✓ Approved</span>;
  if (day.status === "change_requested") return <span className="chip warn">Change requested</span>;
  return <span className="chip">Awaiting {state.settings.nannyName}</span>;
}

type Editing = null | "schedule" | "request" | "worked";

function DayRow({
  role,
  state,
  week,
  day,
  index,
  act,
  busy,
}: {
  role: Role;
  state: State;
  week: Week;
  day: Day;
  index: number;
  act: ActFn;
  busy: boolean;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const phase = phaseOf(week);
  const isToday = day.date === localToday();
  const base = { week: week.start, date: day.date };
  const worked = workedShift(day);
  const diff = day.worked ? shiftHours(worked) - shiftHours(day.shift) : 0;

  const done = async (ok: boolean) => ok && setEditing(null);

  return (
    <div className={`day card ${isToday ? "today" : ""} ${!day.shift && !day.worked ? "off" : ""}`}>
      <div className="dayhead">
        <div>
          <div className="dayname">
            {WEEKDAYS[index]} <span className="muted">{fmtDate(day.date, { month: "short", day: "numeric" })}</span>
            {isToday && <span className="chip small-chip">Today</span>}
          </div>
          <div className="shift">
            {describeShift(day.shift)}
            {day.shift && <span className="muted"> · {hrs(shiftHours(day.shift))}</span>}
          </div>
        </div>
        {phase === "proposed" && <StatusChip day={day} state={state} />}
      </div>

      {day.request && (
        <div className="note warn-text">
          {state.settings.nannyName} asked for <strong>{describeShift(day.request.shift)}</strong>
          {day.request.note && <> — “{day.request.note}”</>}
        </div>
      )}

      {day.worked && (
        <div className="note">
          Actually worked <strong>{describeShift(day.worked.shift)}</strong> ({diff >= 0 ? "+" : ""}
          {round2(diff)} hr){day.worked.note && <> — “{day.worked.note}”</>}
          <span className="muted small">
            {" "}
            · logged by {day.worked.by === "parent" ? state.settings.parentName : state.settings.nannyName}
          </span>
        </div>
      )}

      {editing && (
        <ShiftEditor
          initial={editing === "request" ? day.request?.shift ?? day.shift : editing === "worked" ? worked : day.shift}
          withNote={editing !== "schedule"}
          notePlaceholder={editing === "request" ? "Reason (optional)" : "What happened? (optional)"}
          saveLabel={editing === "request" ? "Send request" : "Save"}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (shift, note) => {
            if (editing === "schedule") done(await act({ type: "setShift", ...base, shift }));
            if (editing === "request") done(await act({ type: "requestChange", ...base, shift, note }));
            if (editing === "worked") done(await act({ type: "setWorked", ...base, shift, note }));
          }}
        />
      )}

      {!editing && phase !== "signed" && (
        <div className="row actions">
          {/* Parent: edit the schedule at any point before sign-off (re-approval needed once sent). */}
          {role === "parent" && day.status === "change_requested" && (
            <>
              <button className="primary" disabled={busy} onClick={() => act({ type: "acceptRequest", ...base })}>
                Accept
              </button>
              <button disabled={busy} onClick={() => act({ type: "declineRequest", ...base })}>
                Keep original
              </button>
            </>
          )}
          {role === "parent" && (phase === "draft" || phase === "proposed") && (
            <button disabled={busy} onClick={() => setEditing("schedule")}>
              {phase === "draft" ? "Set hours" : "Edit"}
            </button>
          )}

          {role === "nanny" && phase === "proposed" && day.status === "pending" && (
            <button className="primary" disabled={busy} onClick={() => act({ type: "approveDay", ...base })}>
              Approve
            </button>
          )}
          {role === "nanny" && phase === "proposed" && (
            <button disabled={busy} onClick={() => setEditing("request")}>
              {day.status === "change_requested" ? "Edit request" : "Request change"}
            </button>
          )}

          {phase === "confirmed" && (
            <>
              <button disabled={busy} onClick={() => setEditing("worked")}>
                {day.worked ? "Edit actual hours" : "Hours were different"}
              </button>
              {day.worked && (
                <button className="link" disabled={busy} onClick={() => act({ type: "clearWorked", ...base })}>
                  Reset to schedule
                </button>
              )}
              {role === "parent" && (
                <button className="link" disabled={busy} onClick={() => setEditing("schedule")}>
                  Change schedule
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ShiftEditor({
  initial,
  withNote,
  notePlaceholder,
  saveLabel,
  busy,
  onSave,
  onCancel,
}: {
  initial: Shift | null;
  withNote: boolean;
  notePlaceholder?: string;
  saveLabel: string;
  busy: boolean;
  onSave: (shift: Shift | null, note: string) => void;
  onCancel?: () => void;
}) {
  const [off, setOff] = useState(!initial);
  const [start, setStart] = useState(initial?.start ?? "09:00");
  const [end, setEnd] = useState(initial?.end ?? "17:00");
  const [note, setNote] = useState("");
  const shift = off ? null : { start, end };
  const invalid = !off && (!start || !end || start === end);

  return (
    <div className="editor">
      <label className="check">
        <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} /> Day off
      </label>
      {!off && (
        <div className="row times">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start" />
          <span className="muted">to</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End" />
          {!invalid && <span className="muted small">{hrs(shiftHours({ start, end }))}</span>}
        </div>
      )}
      {withNote && (
        <input type="text" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={notePlaceholder} />
      )}
      <div className="row">
        <button className="primary" disabled={busy || invalid} onClick={() => onSave(shift, note)}>
          {saveLabel}
        </button>
        {onCancel && (
          <button className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function Totals({
  role,
  week,
  currency,
  totals,
  act,
  busy,
}: {
  role: Role;
  week: Week;
  currency: string;
  totals: ReturnType<typeof weekTotals>;
  act: ActFn;
  busy: boolean;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [rate, setRate] = useState(String(week.rate));
  const showWorked = totals.hours !== totals.scheduledHours;

  return (
    <div className="card totals">
      <div>
        <div className="muted small">Scheduled</div>
        <div className="big">{hrs(totals.scheduledHours)}</div>
      </div>
      {showWorked && (
        <div>
          <div className="muted small">Worked</div>
          <div className="big">{hrs(totals.hours)}</div>
        </div>
      )}
      <div>
        <div className="muted small">Rate</div>
        {editingRate ? (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: "setRate", week: week.start, rate: Number(rate) })) setEditingRate(false);
            }}
          >
            <input className="rate" type="number" step="0.01" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
            <button className="primary" disabled={busy}>
              Save
            </button>
          </form>
        ) : (
          <div className="big">
            {money(week.rate, currency)}/hr
            {role === "parent" && phaseOf(week) !== "signed" && (
              <button
                className="link small"
                onClick={() => {
                  setRate(String(week.rate));
                  setEditingRate(true);
                }}
              >
                edit
              </button>
            )}
          </div>
        )}
      </div>
      <div>
        <div className="muted small">Pay</div>
        <div className="big">{money(totals.pay, currency)}</div>
      </div>
    </div>
  );
}

function SignOff({
  role,
  state,
  week,
  totals,
  act,
  busy,
}: {
  role: Role;
  state: State;
  week: Week;
  totals: ReturnType<typeof weekTotals>;
  act: ActFn;
  busy: boolean;
}) {
  const lastWorkDay = [...week.days].reverse().find((d) => workedShift(d))?.date ?? week.days[6].date;
  const early = localToday() < lastWorkDay;
  const currency = currencyOf(state, week);
  const people: [Role, string][] = [
    ["parent", state.settings.parentName],
    ["nanny", state.settings.nannyName],
  ];

  return (
    <div className="card signoff">
      <h2>End-of-week sign-off</h2>
      <ul className="sigs">
        {people.map(([r, name]) => {
          const s = week.signoffs[r];
          return (
            <li key={r}>
              <span className={s ? "ok-text" : "muted"}>{s ? "✓" : "○"}</span> <strong>{name}</strong>{" "}
              {s ? (
                <span className="muted small">
                  signed {fmtStamp(s.at)} for {hrs(s.hours)} / {money(s.pay, s.currency ?? currency)}
                </span>
              ) : (
                <span className="muted small">not signed yet</span>
              )}
            </li>
          );
        })}
      </ul>
      {!week.signoffs[role] && (
        <>
          {early && <p className="muted small">The week isn't over yet. You can sign now, but any later change clears the signatures.</p>}
          <button
            className="primary block"
            disabled={busy}
            onClick={() =>
              confirm(`Sign off on ${hrs(totals.hours)} for ${money(totals.pay, currency)}?`) && act({ type: "signOff", week: week.start })
            }
          >
            Sign off: {hrs(totals.hours)} · {money(totals.pay, currency)}
          </button>
        </>
      )}
    </div>
  );
}

// ---------- history ----------

function History({ state, open }: { state: State; open: (week: string) => void }) {
  const weeks = useMemo(() => Object.values(state.weeks).sort((a, b) => b.start.localeCompare(a.start)), [state.weeks]);
  const year = String(new Date().getFullYear());
  const signedThisYear = weeks.filter((w) => phaseOf(w) === "signed" && w.start.startsWith(year));
  const ytdHours = signedThisYear.reduce((acc, w) => acc + weekTotals(w).hours, 0);
  // Pay is summed per currency, in case the currency changed during the year.
  const ytdPay = new Map<string, number>();
  for (const w of signedThisYear) {
    const c = currencyOf(state, w);
    ytdPay.set(c, (ytdPay.get(c) ?? 0) + weekTotals(w).pay);
  }
  if (ytdPay.size === 0) ytdPay.set(currencyOf(state), 0);
  const labels = { draft: "Draft", proposed: "Awaiting approval", confirmed: "Agreed · not signed", signed: "Signed" };

  return (
    <section>
      <div className="card totals">
        <div>
          <div className="muted small">{year} signed hours</div>
          <div className="big">{hrs(ytdHours)}</div>
        </div>
        <div>
          <div className="muted small">{year} signed pay</div>
          <div className="big">
            {[...ytdPay].map(([c, pay]) => (
              <div key={c}>{money(round2(pay), c)}</div>
            ))}
          </div>
        </div>
        <a className="button" href="/api/export">
          Export CSV
        </a>
      </div>
      {weeks.length === 0 && <p className="muted centertext">No weeks yet.</p>}
      <div className="history">
        {weeks.map((w) => {
          const t = weekTotals(w);
          const phase = phaseOf(w);
          return (
            <button key={w.start} className="card histrow" onClick={() => open(w.start)}>
              <div>
                <strong>{fmtWeek(w.start)}</strong>
                <div>
                  <span className={`chip ${phase === "signed" ? "ok" : phase === "proposed" ? "warn" : ""}`}>{labels[phase]}</span>
                </div>
              </div>
              <div className="right">
                <div>{hrs(t.hours)}</div>
                <div className="muted small">{money(t.pay, currencyOf(state, w))}</div>
              </div>
            </button>
          );
        })}
      </div>
      <p className="muted small centertext">The CSV export includes every week signed by both sides.</p>
    </section>
  );
}

// ---------- calendar ----------

function timeZones(current?: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    // older browsers: just offer the current one
  }
  const mine = current || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return all.includes(mine) ? all : [mine, ...all];
}

function CalendarView({ state }: { state: State }) {
  const [links, setLinks] = useState<{ https: string; webcal: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/calendar", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setLinks)
      .catch(() => setError("Couldn't load the calendar link. Please try again."));
  }, []);

  const name = encodeURIComponent("James Journal");
  const copy = async () => {
    if (!links) return;
    await navigator.clipboard.writeText(links.https);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <section>
      <div className="card form">
        <h2>📅 Add to your calendar</h2>
        <p>
          Subscribe once and every approved day with {state.settings.nannyName} shows up in your calendar
          automatically. If plans change, the calendar updates too.
        </p>
        {error && <div className="error-text">{error}</div>}
        {links && (
          <>
            <a
              className="button primary"
              href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(links.webcal)}`}
              target="_blank"
              rel="noreferrer"
            >
              Add to Google Calendar
            </a>
            <a
              className="button primary"
              href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(links.https)}&name=${name}`}
              target="_blank"
              rel="noreferrer"
            >
              Add to Outlook
            </a>
            <a
              className="button"
              href={`https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(links.https)}&name=${name}`}
              target="_blank"
              rel="noreferrer"
            >
              Add to Outlook (work or school account)
            </a>
            <a className="button" href={links.webcal}>
              Add to iPhone / Apple Calendar
            </a>
            <button onClick={copy}>{copied ? "Copied!" : "Copy calendar link"}</button>
          </>
        )}
      </div>

      <div className="card">
        <h2>If a button doesn&apos;t work</h2>
        <p className="muted small">
          Copy the calendar link above, then on a computer:
        </p>
        <ul className="small">
          <li>
            <strong>Google Calendar:</strong> next to &ldquo;Other calendars&rdquo; tap <strong>+</strong> →{" "}
            <strong>From URL</strong> → paste → <strong>Add calendar</strong>.
          </li>
          <li>
            <strong>Outlook:</strong> <strong>Add calendar</strong> → <strong>Subscribe from web</strong> → paste →{" "}
            <strong>Import</strong>.
          </li>
        </ul>
        <p className="muted small">
          Google and Outlook check for updates every few hours, so a change can take a little while to appear. Keep the
          link private: anyone with it can see the schedule.
        </p>
      </div>
    </section>
  );
}

// ---------- settings ----------

function SettingsView({ state, act, busy }: { state: State; act: ActFn; busy: boolean }) {
  const [settings, setSettings] = useState({
    ...state.settings,
    currency: currencyOf(state),
    timeZone: state.settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    hourlyRate: String(state.settings.hourlyRate),
  });
  const [template, setTemplate] = useState<(Shift | null)[]>(state.template);
  const [saved, setSaved] = useState<string | null>(null);

  const flash = (msg: string) => {
    setSaved(msg);
    setTimeout(() => setSaved(null), 2500);
  };

  return (
    <section>
      <Sharing state={state} flash={flash} />

      <form
        className="card form"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await act({ type: "saveSettings", settings: { ...settings, hourlyRate: Number(settings.hourlyRate) } });
          if (ok) flash("Settings saved");
        }}
      >
        <h2>Basics</h2>
        <label>
          Your name (as shown to the nanny)
          <input value={settings.parentName} onChange={(e) => setSettings({ ...settings, parentName: e.target.value })} />
        </label>
        <label>
          Nanny's name
          <input value={settings.nannyName} onChange={(e) => setSettings({ ...settings, nannyName: e.target.value })} />
        </label>
        <label>
          Pay currency
          <select value={settings.currency} onChange={(e) => setSettings({ ...settings, currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hourly rate ({settings.currency})
          <input
            type="number"
            step="0.01"
            min="0"
            value={settings.hourlyRate}
            onChange={(e) => setSettings({ ...settings, hourlyRate: e.target.value })}
          />
        </label>
        <label>
          Time zone (for calendar times)
          <select value={settings.timeZone ?? ""} onChange={(e) => setSettings({ ...settings, timeZone: e.target.value })}>
            {timeZones(settings.timeZone).map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Currency and rate apply to new weeks and to weeks not yet signed. Signed weeks keep the terms they were signed
          with.
        </p>
        <button className="primary" disabled={busy}>
          Save
        </button>
      </form>

      <div className="card form">
        <h2>Default weekly schedule</h2>
        <p className="muted small">Used when you start a new week from the default. You can still adjust each week.</p>
        {WEEKDAYS.map((name, i) => {
          const s = template[i];
          const set = (v: Shift | null) => setTemplate(template.map((t, j) => (j === i ? v : t)));
          return (
            <div key={name} className="row tmplrow">
              <strong className="wd">{name}</strong>
              <label className="check">
                <input type="checkbox" checked={!s} onChange={(e) => set(e.target.checked ? null : { start: "09:00", end: "17:00" })} />{" "}
                Off
              </label>
              {s && (
                <>
                  <input type="time" value={s.start} onChange={(e) => set({ ...s, start: e.target.value })} aria-label={`${name} start`} />
                  <span className="muted">–</span>
                  <input type="time" value={s.end} onChange={(e) => set({ ...s, end: e.target.value })} aria-label={`${name} end`} />
                </>
              )}
            </div>
          );
        })}
        <div className="muted small">Total: {hrs(template.reduce((a, s) => a + shiftHours(s), 0))} per week</div>
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (await act({ type: "saveTemplate", template })) flash("Default schedule saved");
          }}
        >
          Save default schedule
        </button>
      </div>

      {saved && <div className="toast">{saved}</div>}
    </section>
  );
}

function Sharing({ state, flash }: { state: State; flash: (msg: string) => void }) {
  const [links, setLinks] = useState<{ nanny: string; parent: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nanny = state.settings.nannyName;

  useEffect(() => {
    fetch("/api/links", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setLinks)
      .catch(() => setError("Couldn't load the links."));
  }, []);

  async function share(url: string, text: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title: "James Journal", text, url });
        return;
      } catch {
        // cancelled or unsupported: fall back to copying
      }
    }
    await navigator.clipboard.writeText(url);
    flash("Link copied");
  }

  async function reset() {
    if (!confirm(`Make new links? The old ones stop working, and ${nanny} and any other parent devices will need the new link.`)) return;
    const res = await fetch("/api/links", { method: "POST" });
    if (res.ok) {
      setLinks(await res.json());
      flash("New links created");
    } else setError("Couldn't reset the links.");
  }

  return (
    <div className="card form">
      <h2>Sharing</h2>
      {error && <div className="error-text">{error}</div>}
      {links && (
        <>
          <p className="muted small">
            Send {nanny} a personal link. Opening it once on their phone signs them in for good. Nothing to type. Keep it
            private: anyone with the link can act as {nanny}.
          </p>
          <div className="row">
            <button className="primary" onClick={() => share(links.nanny, `Hi ${nanny}! Here's your link to James Journal, our shared spot for lining up hours with James. Tap it once and you're in:`)}>
              Send link to {nanny}
            </button>
            <button onClick={() => navigator.clipboard.writeText(links.nanny).then(() => flash("Link copied"))}>Copy</button>
          </div>
          <p className="muted small">To use this app as a parent on another phone or computer, open this link there:</p>
          <div className="row">
            <button onClick={() => share(links.parent, "Parent link for James Journal:")}>Share parent link</button>
          </div>
          <p className="muted small">If a link ever gets to the wrong person, reset them. Old links stop working.</p>
          <div className="row">
            <button className="danger" onClick={reset}>
              Reset links
            </button>
          </div>
        </>
      )}
    </div>
  );
}
