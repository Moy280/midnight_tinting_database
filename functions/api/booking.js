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

  return json({ ok: true });
}
