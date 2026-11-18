// Helpers for Google Calendar access with a service account.
// Not a route: this file exports no onRequest handlers.

export const TZ = 'America/Chicago';
export const APPOINTMENT_MINUTES = 180;

// Gets an access token using the calendar owner's refresh token (no key file needed).
export async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error('Google token request failed: ' + res.status);
  return (await res.json()).access_token;
}

// Offset of TZ from UTC at a given instant, in milliseconds (local minus UTC).
function tzOffsetMs(utcMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

// Converts a wall-clock time in TZ on a YYYY-MM-DD date to a Date.
export function zonedToDate(dateStr, hour, minute) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, hour, minute);
  const first = guess - tzOffsetMs(guess);
  return new Date(guess - tzOffsetMs(first));
}

export function isSunday(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === 0;
}

export async function getBusy(env, token, timeMin, timeMax) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: TZ,
      items: [{ id: env.GOOGLE_CALENDAR_ID }],
    }),
  });
  if (!res.ok) throw new Error('Google freeBusy failed: ' + res.status);
  const data = await res.json();
  const cal = data.calendars && data.calendars[env.GOOGLE_CALENDAR_ID];
  if (cal && cal.errors && cal.errors.length) throw new Error('Calendar not accessible');
  return (cal ? cal.busy : []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export function overlaps(start, end, busy) {
  return busy.some((b) => start < b.end && end > b.start);
}

export function formatTime(hour, minute) {
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return h + ':' + String(minute).padStart(2, '0') + ' ' + ampm;
}

export function parseTime(label) {
  const m = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/.exec(String(label || '').trim());
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3] === 'PM') hour += 12;
  return { hour, minute: Number(m[2]) };
}

// Slot starts from 8:00 AM to 2:00 PM every 30 minutes (last start 2:00 PM, ends 5:00 PM).
export const SLOT_STARTS = (() => {
  const out = [];
  for (let h = 8; h <= 14; h++) {
    for (const m of [0, 30]) {
      if (h === 14 && m === 30) break;
      out.push({ hour: h, minute: m });
    }
  }
  return out;
})();
