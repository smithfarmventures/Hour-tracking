# James Journal

A small web app for agreeing on a nanny's weekly schedule and signing off on hours worked.

## How it works

1. **Parents propose** next week's schedule. Start from the saved default schedule (Settings) or from blank, adjust the days, then **Send**.
2. **The nanny reviews** each day: **Approve** it (or **Approve all**), or **Request change** with different times or a day off, plus an optional note.
3. **Parents respond** to each request: **Accept** it, **Keep original** (the nanny re-confirms that day), or **Edit** to counter-propose. Once every day is approved, the week is **agreed**.
4. **During the week**, either person can tap **Hours were different** on a day to log what was actually worked (stayed late, sent home early) with a note.
5. **At the end of the week**, each person taps **Sign off**, which records the total hours and pay. When both have signed, the week is **locked**, and a write-once copy is saved as a backup.

Any change to hours after someone signs clears both signatures, so each signature always matches the final numbers. Every action is recorded in the week's **Activity** log, with who did it and when.

The **History** tab lists every week and shows year-to-date signed hours and pay. **Export CSV** downloads every fully signed week, day by day, for payroll and tax records.

Pay is hours × that week's hourly rate, in the currency chosen in Settings: Israeli shekels, US dollars, euros, pounds, or Canadian or Australian dollars. Changing the currency or rate updates weeks that aren't signed yet (a week with a custom rate keeps it). Signed weeks keep the terms they were signed with.

## Calendar

Tap **📅 Calendar** to subscribe to a private calendar feed of approved days. There are one-tap buttons for Google Calendar, Outlook (personal or work) and Apple Calendar, plus a link to copy. Events follow the schedule automatically: changed, cancelled and longer-than-planned days update on the next refresh. Google and Outlook re-check subscribed calendars every few hours. Times use the family's time zone, which is taken from the parent's device and can be changed in Settings. **Reset links** also replaces the calendar link.

## Sign-in (no passwords)

- **First run:** the first person to open the freshly deployed site taps **Set up on this device** and becomes the parent on that device.
- **Nanny:** in **Settings → Sharing**, tap **Send link to …** to text or copy the nanny's personal link. Opening it once signs that phone in.
- **More parent devices:** share the parent link from the same section and open it on the other device.
- **Lost or leaked link:** **Reset links** makes new links and signs out every other device.

Devices stay signed in for about a year, and the cookie is refreshed each time a link is used. Links are secret 192-bit keys stored with the app data and never shown to the nanny's device. No environment variables are needed.

## Storage

All data is one JSON document in a **private Vercel Blob** store (`BLOB_READ_WRITE_TOKEN` is set automatically when the store is connected to the project). Writes are conditional on the version that was read, so two people saving at once can't overwrite each other. Fully signed weeks are also copied to `signed/week-<date>-*.json` in the same store.

Without Blob credentials (local development), data lives in `.data/state.json`.

## Development

```bash
npm install
npm run dev                  # http://localhost:3000
npm test                     # business-rule tests (lib/model.test.ts)
npm run typecheck
```

All business rules (who can do what, and when) are in `lib/model.ts`. The API routes in `app/api/*` load the state, apply one action as the signed-in role, and save the result.
