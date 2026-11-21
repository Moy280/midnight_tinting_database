// Admin API: send one booking's review request now, instead of waiting for the daily job.
import { json, requireAdmin } from '../../lib/admin.js';
import { sendReviewRequest } from '../../lib/emails.js';

export async function onRequestPost({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }
  const id = Number(data.id);
  if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'Invalid booking.' }, 400);

  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'Email is not configured.' }, 500);
  if (!env.GOOGLE_REVIEW_URL) {
    return json({ ok: false, error: 'The review link is not set. Add GOOGLE_REVIEW_URL in the Pages settings first.' }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT id, name, email, year, make, model FROM bookings WHERE id = ?'
  ).bind(id).first();
  if (!row) return json({ ok: false, error: 'Booking not found.' }, 404);
  if (!row.email) return json({ ok: false, error: 'This booking has no email address.' }, 400);

  const ok = await sendReviewRequest(env, row).catch(() => false);
  if (!ok) return json({ ok: false, error: 'The email could not be sent. Try again in a moment.' }, 502);

  await env.DB.prepare("UPDATE bookings SET review_sent_at = datetime('now') WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
