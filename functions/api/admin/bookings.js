// Admin API: list bookings (GET) and add a booking by hand (POST).
import { json, clean, requireAdmin, STATUSES, SOURCES } from '../../lib/admin.js';
import {
  APPOINTMENT_MINUTES, createEvent, getAccessToken, getBusy, isSunday, overlaps,
  parseTime, zonedToDate,
} from '../../lib/google.js';
import { validateBooking } from '../booking.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COLUMNS = `id, created_at, name, phone, email, year, make, model, film, package,
  preferred_date, preferred_time, notes, consent, status, source, internal_notes, updated_at`;

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const q = clean(url.searchParams.get('q'), 100);

  const where = [];
  const binds = [];
  if (STATUSES.includes(status)) {
    where.push('status = ?');
    binds.push(status);
  }
  if (q) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ? OR make LIKE ? OR model LIKE ?)');
    for (let i = 0; i < 5; i++) binds.push('%' + q + '%');
  }
  let sql = 'SELECT ' + COLUMNS + ' FROM bookings';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC, id DESC LIMIT 200';

  const rows = await env.DB.prepare(sql).bind(...binds).all();
  const counts = await env.DB.prepare('SELECT status, COUNT(*) AS n FROM bookings GROUP BY status').all();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of counts.results || []) byStatus[r.status] = r.n;

  return json({ ok: true, bookings: rows.results || [], counts: byStatus });
}

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const row = {
    name: clean(data.name, 100),
    phone: clean(data.phone, 30),
    email: clean(data.email, 120),
    year: clean(data.year, 4),
    make: clean(data.make, 60),
    model: clean(data.model, 60),
    film: clean(data.film, 60),
    package: clean(data.package, 100),
    preferred_date: clean(data.date, 10),
    preferred_time: clean(data.time, 20),
    notes: clean(data.notes, 1000),
  };
  const source = SOURCES.includes(data.source) ? data.source : 'Phone';
  const status = STATUSES.includes(data.status) ? data.status : 'booked';
  const internalNotes = clean(data.internal_notes, 2000);

  // Email stays required, as it is for website bookings.
  const required = ['name', 'phone', 'email', 'year', 'make', 'model', 'film', 'package', 'preferred_date', 'preferred_time'];
  for (const k of required) {
    if (!row[k]) return json({ ok: false, error: 'Please fill in all required fields.' }, 400);
  }
  if (!EMAIL_RE.test(row.email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.preferred_date)) return json({ ok: false, error: 'Please choose a valid date.' }, 400);
  const problem = validateBooking(row);
  if (problem) return json({ ok: false, error: problem }, 400);
  if (isSunday(row.preferred_date)) return json({ ok: false, error: 'We are closed on Sundays. Please choose another day.' }, 400);

  const t = parseTime(row.preferred_time);
  if (!t || t.hour < 8 || t.hour > 14 || (t.hour === 14 && t.minute > 0)) {
    return json({ ok: false, error: 'Please choose a start time between 8:00 AM and 2:00 PM.' }, 400);
  }

  const start = zonedToDate(row.preferred_date, t.hour, t.minute);
  const end = new Date(start.getTime() + APPOINTMENT_MINUTES * 60000);
  if (start.getTime() < Date.now()) {
    return json({ ok: false, error: 'That time has already passed. Please choose another time.' }, 400);
  }

  try {
    const token = await getAccessToken(env);
    const busy = await getBusy(env, token, start, end);
    if (overlaps(start, end, busy)) {
      return json({ ok: false, error: 'That time is already booked on the calendar. Please choose another time.' }, 409);
    }
    await createEvent(env, token, {
      summary: 'Tint: ' + row.name + ' (' + row.film + ')',
      description: [
        'Source: ' + source,
        'Phone: ' + row.phone,
        'Email: ' + row.email,
        'Vehicle: ' + row.year + ' ' + row.make + ' ' + row.model,
        'Film: ' + row.film,
        'Package: ' + row.package,
        'Notes: ' + (row.notes || 'None'),
      ].join('\n'),
      start,
      end,
    });
  } catch (err) {
    console.error('admin calendar step failed', err);
    return json({ ok: false, error: 'Could not reserve that time on the calendar. Check the calendar and try again.' }, 500);
  }

  // Phone bookings record consent as verbal. The website form records it as a checked box.
  const savedInternal = ['Consent: verbal, by phone.', internalNotes].filter(Boolean).join('\n');

  try {
    const res = await env.DB.prepare(
      `INSERT INTO bookings
        (name, phone, email, year, make, model, film, package, preferred_date, preferred_time,
         notes, consent, status, source, internal_notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now'))`
    ).bind(
      row.name, row.phone, row.email, row.year, row.make, row.model,
      row.film, row.package, row.preferred_date, row.preferred_time, row.notes,
      status, source, savedInternal
    ).run();
    return json({ ok: true, id: res.meta && res.meta.last_row_id });
  } catch (err) {
    // The calendar event exists but the row did not save. Say so, so it can be fixed by hand.
    console.error('admin booking insert failed', err);
    return json({
      ok: false,
      error: 'The time was held on the calendar, but the booking could not be saved. Check the calendar entry and add the booking again.',
    }, 500);
  }
}
