import {
  APPOINTMENT_MINUTES, SLOT_STARTS, formatTime, getAccessToken, getBusy,
  isSunday, overlaps, zonedToDate,
} from '../lib/google.js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  const date = new URL(request.url).searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ ok: false, error: 'Invalid date.' }, 400);
  if (isSunday(date)) return json({ ok: true, times: [], closed: true });

  try {
    const token = await getAccessToken(env);
    const dayStart = zonedToDate(date, 8, 0);
    const dayEnd = zonedToDate(date, 17, 0);
    const busy = await getBusy(env, token, dayStart, dayEnd);
    const now = Date.now();
    const times = [];
    for (const { hour, minute } of SLOT_STARTS) {
      const start = zonedToDate(date, hour, minute);
      const end = new Date(start.getTime() + APPOINTMENT_MINUTES * 60000);
      if (start.getTime() < now) continue;
      if (end > dayEnd) continue;
      if (overlaps(start, end, busy)) continue;
      times.push(formatTime(hour, minute));
    }
    return json({ ok: true, times });
  } catch (err) {
    console.error('availability failed', err);
    return json({ ok: false, error: 'Could not check availability. Please call us.' }, 500);
  }
}
