// Customer emails sent by the admin and the daily job. Not a route: no onRequest handlers.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// "2026-12-02" -> "December 2, 2026"
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso;
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

// Returns true if Resend accepted the email.
export async function sendEmail(env, row, subject, lines) {
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

export function sendReminder(env, row) {
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

export function sendReviewRequest(env, row) {
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
