// Admin API: update one booking's status or internal notes.
import { json, clean, requireAdmin, STATUSES } from '../../../lib/admin.js';

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
  if (!sets.length) return json({ ok: false, error: 'Nothing to update.' }, 400);

  sets.push("updated_at = datetime('now')");
  const res = await env.DB.prepare('UPDATE bookings SET ' + sets.join(', ') + ' WHERE id = ?')
    .bind(...binds, id)
    .run();
  if (!res.meta || res.meta.changes === 0) return json({ ok: false, error: 'Booking not found.' }, 404);
  return json({ ok: true });
}
