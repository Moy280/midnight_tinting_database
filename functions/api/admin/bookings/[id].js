// Admin API: update one booking's status or internal notes.
import { json, clean, requireAdmin, STATUSES, dateOrNull } from '../../../lib/admin.js';
import { getAccessToken, parseTime, zonedToDate } from '../../../lib/google.js';

export async function onRequestPatch({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Invalid booking.' }, 400);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  const sets = [];
  const binds = [];
  if (data.status !== undefined) {
    if (!STATUSES.includes(data.status)) return json({ ok: false, error: 'Unknown status.' }, 400);
    sets.push('status = ?');
    binds.push(data.status);
  }
  if (data.internal_notes !== undefined) {
    sets.push('internal_notes = ?');
    binds.push(clean(data.internal_notes, 2000));
  }
  if (data.follow_up_date !== undefined) {
    // Empty clears the follow-up date. Anything else must be a YYYY-MM-DD date.
    const cleared = data.follow_up_date === '' || data.follow_up_date === null;
    const value = cleared ? null : dateOrNull(data.follow_up_date);
    if (!cleared && !value) return json({ ok: false, error: 'Please choose a valid follow-up date.' }, 400);
    sets.push('follow_up_date = ?');
    binds.push(value);
  }
  if (!sets.length) return json({ ok: false, error: 'Nothing to update.' }, 400);

  sets.push("updated_at = datetime('now')");
  const res = await env.DB.prepare('UPDATE bookings SET ' + sets.join(', ') + ' WHERE id = ?')
    .bind(...binds, id)
    .run();
  if (!res.meta || res.meta.changes === 0) return json({ ok: false, error: 'Booking not found.' }, 404);
  return json({ ok: true });
}

// Deletes the booking and its Google Calendar event. The calendar is checked first:
// if it can't be reached, nothing is deleted, so the two never drift apart.
export async function onRequestDelete({ request, env, params }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Invalid booking.' }, 400);

  const row = await env.DB.prepare('SELECT name, preferred_date, preferred_time FROM bookings WHERE id = ?')
    .bind(id)
    .first();
  if (!row) return json({ ok: false, error: 'Booking not found.' }, 404);

  let calendar = 'skipped';
  const t = parseTime(row.preferred_time);
  if (t) {
    const start = zonedToDate(row.preferred_date, t.hour, t.minute);
    const base = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + '/events';
    try {
      const token = await getAccessToken(env);
      const query = new URLSearchParams({
        timeMin: new Date(start.getTime() - 60 * 60000).toISOString(),
        timeMax: new Date(start.getTime() + 60 * 60000).toISOString(),
        singleEvents: 'true',
      });
      const listRes = await fetch(base + '?' + query.toString(), {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!listRes.ok) throw new Error('Calendar list failed: ' + listRes.status);
      const list = await listRes.json();

      const prefix = 'Tint: ' + row.name + ' (';
      const matches = (list.items || []).filter((ev) =>
        String(ev.summary || '').startsWith(prefix) &&
        ev.start && ev.start.dateTime && Date.parse(ev.start.dateTime) === start.getTime()
      );
      for (const ev of matches) {
        const delRes = await fetch(base + '/' + encodeURIComponent(ev.id), {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!delRes.ok && delRes.status !== 410) throw new Error('Calendar delete failed: ' + delRes.status);
      }
      calendar = matches.length ? 'deleted' : 'not found';
    } catch (err) {
      console.error('admin delete: calendar step failed', err);
      return json({
        ok: false,
        error: 'Could not reach the Google Calendar, so the booking was not deleted. Try again in a moment.',
      }, 500);
    }
  }

  await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run();
  return json({ ok: true, calendar });
}
