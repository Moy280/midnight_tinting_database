// Cloudflare Pages Function: receives a booking request and stores it in D1.
// Bound to the database named DB (see wrangler.toml).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX = { name: 100, phone: 30, email: 120, year: 4, make: 60, model: 60, notes: 1000 };

function clean(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}


// Sends a notification email through Resend. Skipped if RESEND_API_KEY is not set.
async function notifyByEmail(env, row) {
  if (!env.RESEND_API_KEY) return;
  const to = env.NOTIFY_TO || 'info@midnight-tint.com';
  const from = env.FROM_EMAIL || 'Midnight Bookings <bookings@midnight-tint.com>';
  const lines = [
    'New booking request',
    '',
    'Name: ' + row.name,
    'Phone: ' + row.phone,
    'Email: ' + row.email,
    '',
    'Vehicle: ' + row.year + ' ' + row.make + ' ' + row.model,
    'Film: ' + row.film,
    'Coverage: ' + row.coverage,
    '',
    'Preferred date: ' + row.preferred_date,
    'Preferred time: ' + (row.preferred_time || 'Any time'),
    '',
    'Notes: ' + (row.notes || 'None'),
  ];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: row.email,
      subject: 'Booking request: ' + row.year + ' ' + row.make + ' ' + row.model + ' (' + row.film + ')',
      text: lines.join('\n'),
    }),
  });
  if (!res.ok) {
    console.error('email notification failed', res.status, await res.text());
  }
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot: real visitors leave this field empty. Bots often fill it in.
  if (clean(data.website, 100) !== '') {
    return json({ ok: true });
  }

  const row = {
    name: clean(data.name, MAX.name),
    phone: clean(data.phone, MAX.phone),
    email: clean(data.email, MAX.email),
    year: clean(data.year, MAX.year),
    make: clean(data.make, MAX.make),
    model: clean(data.model, MAX.model),
    film: clean(data.film, 60),
    coverage: clean(data.coverage, 100),
    preferred_date: clean(data.date, 10),
    preferred_time: clean(data.time, 20),
    notes: clean(data.notes, MAX.notes),
  };

  const required = ['name', 'phone', 'email', 'year', 'make', 'model', 'film', 'coverage', 'preferred_date'];
  for (const k of required) {
    if (!row[k]) return json({ ok: false, error: 'Please fill in all required fields.' }, 400);
  }
  if (!EMAIL_RE.test(row.email)) {
    return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.preferred_date)) {
    return json({ ok: false, error: 'Please choose a valid date.' }, 400);
  }
  if (data.consent !== true && data.consent !== 'on') {
    return json({ ok: false, error: 'Please agree to be contacted about your request.' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO bookings
        (name, phone, email, year, make, model, film, coverage, preferred_date, preferred_time, notes, consent, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'new')`
    ).bind(
      row.name, row.phone, row.email, row.year, row.make, row.model,
      row.film, row.coverage, row.preferred_date, row.preferred_time, row.notes
    ).run();
  } catch (err) {
    console.error('booking insert failed', err);
    return json({ ok: false, error: 'We could not save your request. Please call us.' }, 500);
  }

  // Email is best-effort: the booking is already saved, so a mail failure must not fail the request.
  try {
    await notifyByEmail(env, row);
  } catch (err) {
    console.error('email notification error', err);
  }

  return json({ ok: true });
}
