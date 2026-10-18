import { safeEqual } from "@/lib/auth";
import { buildCalendar } from "@/lib/calendar";
import { loadState } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The subscribable calendar feed: /cal/<calendarKey>.ics */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const key = file.replace(/\.ics$/, "");
  const { state } = await loadState();
  const expected = state.access?.calendarKey;
  if (!expected || !safeEqual(key, expected)) return new Response("Not found", { status: 404 });
  const ics = buildCalendar(state, { appUrl: new URL("/", req.url).toString(), now: new Date() });
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="james-journal.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
