// Runs once a day (see workers/reminders). Sends:
//   1. day-before reminders for tomorrow's booked appointments
//   2. review requests for appointments marked Done about three days ago
// Protected by a shared secret, not by Access.
import { json, chicagoDate } from '../../lib/admin.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// "2026-12-02" -> "December 2, 2026"
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso;
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

async function sendEmail(env, row, subject, lines) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.FROM_EMAIL || 'Midnight Tinting <bookings@midnight-tint.com>',
      to: [row.email],
      reply_to: env.NOTIFY_TO || 'info@midnight-tint.com',
      subject,
      text: lines.join('\n'),
    }),
  });
  if (!res.ok) console.error('email failed', row.id, res.status, await res.text());
  return res.ok;
}

function sendReminder(env, row) {
  return sendEmail(env, row,
    'Reminder: your tint appointment is tomorrow at ' + row.preferred_time,
    [
      'Hi ' + row.name.split(' ')[0] + ',',
      '',
      'A quick reminder that your window tint appointment with Midnight Tinting is tomorrow:',
      '',
      'Date: ' + formatDate(row.preferred_date),
      'Start time: ' + row.preferred_time + ' (about 3 hours)',
      'Vehicle: ' + row.year + ' ' + row.make + ' ' + row.model,
      'Film: ' + row.film,
      'Package: ' + row.package,
      '',
      'We come to you. Please have the vehicle parked where we can work, with the windows clean and rolled up.',
      '',
      'Need to change the time? Call (708) 677-9815 or reply to this email.',
      '',
      'Midnight Tinting',
    ]);
}

function sendReviewRequest(env, row) {
  return sendEmail(env, row,
    'Thanks for choosing Midnight Tinting',
    [
      'Hi ' + row.name.split(' ')[0] + ',',
      '',
      'Thanks for letting us tint your ' + row.year + ' ' + row.make + ' ' + row.model + '. We hope you love how it turned out.',
      '',
      'If you have a minute, a short Google review helps other Chicagoland drivers find us:',
      env.GOOGLE_REVIEW_URL,
      '',
      'If anything is not right, reply to this email or call (708) 677-9815 first, and we will make it right.',
      '',
      'Thank you,',
      'Moises Hernandez',
      'Midnight Tinting',
    ]);
}

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
