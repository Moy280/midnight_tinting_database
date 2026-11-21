// Runs once a day (see workers/reminders). Sends:
//   1. day-before reminders for tomorrow's booked appointments
//   2. review requests for appointments marked Done about three days ago
// Protected by a shared secret, not by Access.
import { json, chicagoDate } from '../../lib/admin.js';
import { sendReminder, sendReviewRequest } from '../../lib/emails.js';

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.REMINDER_SECRET || auth !== 'Bearer ' + env.REMINDER_SECRET) {
    return json({ ok: false, error: 'Not allowed.' }, 403);
  }
  if (!env.RESEND_API_KEY) return json({ ok: false, error: 'Email is not configured.' }, 500);

  // 1. Day-before reminders
  const tomorrow = chicagoDate(1);
  const due = await env.DB.prepare(
    "SELECT id, name, email, year, make, model, film, package, preferred_date, preferred_time " +
    "FROM bookings WHERE preferred_date = ? AND status = 'booked' AND reminder_sent_at IS NULL AND email <> ''"
  ).bind(tomorrow).all();

  let sent = 0;
  let failed = 0;
  for (const row of due.results || []) {
    const ok = await sendReminder(env, row).catch(() => false);
    if (ok) {
      await env.DB.prepare("UPDATE bookings SET reminder_sent_at = datetime('now') WHERE id = ?").bind(row.id).run();
      sent++;
    } else {
      failed++;
    }
  }

  // 2. Review requests, three days after a Done appointment. Only the last two weeks are
  //    considered, so older bookings never get a surprise email.
  let reviewsSent = 0;
  let reviewsFailed = 0;
  if (env.GOOGLE_REVIEW_URL) {
    const asks = await env.DB.prepare(
      "SELECT id, name, email, year, make, model, preferred_date " +
      "FROM bookings WHERE status = 'done' AND review_sent_at IS NULL AND email <> '' " +
      "AND preferred_date <= ? AND preferred_date >= ?"
    ).bind(chicagoDate(-3), chicagoDate(-14)).all();

    for (const row of asks.results || []) {
      const ok = await sendReviewRequest(env, row).catch(() => false);
      if (ok) {
        await env.DB.prepare("UPDATE bookings SET review_sent_at = datetime('now') WHERE id = ?").bind(row.id).run();
        reviewsSent++;
      } else {
        reviewsFailed++;
      }
    }
  }

  return json({
    ok: true, date: tomorrow, sent, failed,
    reviews_sent: reviewsSent, reviews_failed: reviewsFailed,
    reviews_enabled: Boolean(env.GOOGLE_REVIEW_URL),
  });
}
