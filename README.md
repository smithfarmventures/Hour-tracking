# Nanny Hours

A small web app for agreeing on a nanny's weekly schedule and signing off on hours worked.

## How it works

1. **Parents propose** next week's schedule. Start from the saved default schedule (Settings) or from blank, adjust the days, then **Send**.
2. **The nanny reviews** each day: **Approve** it (or **Approve all**), or **Request change** with different times or a day off, plus an optional note.
3. **Parents respond** to each request: **Accept** it, **Keep original** (the nanny re-confirms that day), or **Edit** to counter-propose. Once every day is approved, the week is **agreed**.
4. **During the week**, either person can tap **Hours were different** on a day to log what was actually worked (stayed late, sent home early) with a note.
5. **At the end of the week**, each person taps **Sign off**, which records the total hours and pay. When both have signed, the week is **locked**, and a write-once copy is saved as a backup.

Any change to hours after someone signs clears both signatures, so each signature always matches the final numbers. Every action is recorded in the week's **Activity** log, with who did it and when.

The **History** tab lists every week and shows year-to-date signed hours and pay. **Export CSV** downloads every fully signed week, day by day, for payroll and tax records.

Pay is hours × that week's hourly rate. The rate comes from Settings when the week is created, and the parents can change it per week until the week is signed.

## Sign-in

There are no accounts, just two PINs set as environment variables:

| Variable | Purpose |
| --- | --- |
| `PARENT_PIN` | Parent login (can propose, edit, and change settings) |
| `NANNY_PIN` | Nanny login (can approve, request changes, and log hours) |
| `SESSION_SECRET` | Long random string used to sign login cookies |

Both people stay signed in on their device for about 6 months. Changing a PIN in Vercel (then redeploying) signs that person out everywhere.

## Storage

All data is one JSON document in a **private Vercel Blob** store (`BLOB_READ_WRITE_TOKEN` is set automatically when the store is connected to the project). Writes are conditional on the version that was read, so two people saving at once can't overwrite each other. Fully signed weeks are also copied to `signed/week-<date>-*.json` in the same store.

Without Blob credentials (local development), data lives in `.data/state.json`.

## Development

```bash
npm install
cp .env.example .env.local   # set the PINs
npm run dev                  # http://localhost:3000
npm test                     # business-rule tests (lib/model.test.ts)
npm run typecheck
```

All business rules (who can do what, and when) are in `lib/model.ts`. The API routes in `app/api/*` load the state, apply one action as the signed-in role, and save the result.
