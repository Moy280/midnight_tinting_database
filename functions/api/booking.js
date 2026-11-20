// Pages Function: receives a booking request, checks the calendar, creates the
// calendar event, saves the booking to D1, and emails the details.
import {
  APPOINTMENT_MINUTES, TZ, getAccessToken, getBusy, isSunday, overlaps,
  parseTime, zonedToDate,
} from '../lib/google.js';

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


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// "7086779815" or "17086779815" -> "(708)-677-9815"
function formatPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return raw;
  return '(' + ten.slice(0, 3) + ') ' + ten.slice(3, 6) + '-' + ten.slice(6);
}

// "2026-12-02" -> "December 2, 2026"
function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return iso;
  return MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
}

async function notifyByEmail(env, row, startLabel) {
  if (!env.RESEND_API_KEY) return;
  const to = env.NOTIFY_TO || 'info@midnight-tint.com';
  const from = env.FROM_EMAIL || 'Midnight Bookings <bookings@midnight-tint.com>';
  const lines = [
    'New booking request',
    '',
    'Name: ' + row.name,
    'Phone: ' + formatPhone(row.phone),
    'Email: ' + row.email,
    '',
    'Vehicle: ' + row.year + ' ' + row.make + ' ' + row.model,
    'Film: ' + row.film,
    'Package: ' + row.package,
    '',
    'Date: ' + formatDate(row.preferred_date),
    'Start time: ' + startLabel + ' (3-hour appointment)',
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
      subject: 'Booking: ' + formatDate(row.preferred_date) + ' ' + startLabel + ' - ' + row.year + ' ' + row.make + ' ' + row.model,
      text: lines.join('\n'),
    }),
  });
  if (!res.ok) console.error('email notification failed', res.status, await res.text());
}


// Sends the customer a receipt of their request. It does not confirm the appointment.
async function confirmToCustomer(env, row, startLabel) {
  if (!env.RESEND_API_KEY) return;
  const from = env.FROM_EMAIL || 'Midnight Tinting <bookings@midnight-tint.com>';
  const lines = [
    'Hi ' + row.name.split(' ')[0] + ',',
    '',
    'Thanks for your request with Midnight Tinting. We received it and will reply to confirm your appointment time.',
    '',
    'Requested details:',
    'Date: ' + formatDate(row.preferred_date),
    'Start time: ' + startLabel + ' (about 3 hours)',
    'Vehicle: ' + row.year + ' ' + row.make + ' ' + row.model,
    'Film: ' + row.film,
    'Package: ' + row.package,
    '',
    'Your request is not confirmed until we reply. Questions? Call (708) 677-9815 or reply to this email.',
    '',
    'Midnight Tinting',
  ];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [row.email],
      reply_to: env.NOTIFY_TO || 'info@midnight-tint.com',
      subject: 'We received your booking request',
      text: lines.join('\n'),
    }),
  });
  if (!res.ok) console.error('customer receipt failed', res.status, await res.text());
}

async function createCalendarEvent(env, token, row, start, end) {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(env.GOOGLE_CALENDAR_ID) + '/events',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: 'Tint: ' + row.name + ' (' + row.film + ')',
        description: [
          'Phone: ' + row.phone,
          'Email: ' + row.email,
          'Vehicle: ' + row.year + ' ' + row.make + ' ' + row.model,
          'Film: ' + row.film,
          'Package: ' + row.package,
          'Notes: ' + (row.notes || 'None'),
        ].join('\n'),
        start: { dateTime: start.toISOString(), timeZone: TZ },
        end: { dateTime: end.toISOString(), timeZone: TZ },
      }),
    }
  );
  if (!res.ok) throw new Error('Calendar event failed: ' + res.status);
  return res.json();
}


const FILMS = ['Uviron PureMax Carbon', 'GeoShield C2 Ceramic'];
const PACKAGES = ['Full Vehicle (No Front Windshield)', 'Front only', 'Custom'];

// Returns an error message for the first bad field, or null if everything looks valid.
export function validateBooking(row) {
  const thisYear = new Date().getUTCFullYear();
  const digits = row.phone.replace(/\D/g, '');
  const phoneDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;

  if (!/^[A-Za-z][A-Za-z .'-]{1,99}$/.test(row.name) || !/[A-Za-z].*[A-Za-z]/.test(row.name)) {
    return 'Please enter your full name, using letters only.';
  }
  if (phoneDigits.length !== 10 || /^(\d)\1{9}$/.test(phoneDigits)) {
    return 'Please enter a valid 10-digit phone number.';
  }
  if (!/^\d{4}$/.test(row.year) || Number(row.year) < 1980 || Number(row.year) > thisYear + 1) {
    return 'Please enter a valid vehicle year.';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&-]{1,39}$/.test(row.make) || !/[A-Za-z]{2}/.test(row.make)) {
    return 'Please enter a valid vehicle make.';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&+-]{0,39}$/.test(row.model)) {
    return 'Please enter a valid vehicle model.';
  }
  if (!FILMS.includes(row.film)) return 'Please choose a film.';
  if (!PACKAGES.includes(row.package)) return 'Please choose a package.';
  return null;
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request.' }, 400);
  }

  // Honeypot: real visitors leave this field empty.
  if (clean(data.website, 100) !== '') return json({ ok: true });

  const row = {
    name: clean(data.name, MAX.name),
    phone: clean(data.phone, MAX.phone),
    email: clean(data.email, MAX.email),
    year: clean(data.year, MAX.year),
    make: clean(data.make, MAX.make),
    model: clean(data.model, MAX.model),
    film: clean(data.film, 60),
    package: clean(data.package, 100),
    preferred_date: clean(data.date, 10),
    preferred_time: clean(data.time, 20),
    notes: clean(data.notes, MAX.notes),
  };

  const required = ['name', 'phone', 'email', 'year', 'make', 'model', 'film', 'package', 'preferred_date', 'preferred_time'];
  for (const k of required) {
    if (!row[k]) return json({ ok: false, error: 'Please fill in all required fields.' }, 400);
  }
  if (!EMAIL_RE.test(row.email)) return json({ ok: false, error: 'Please enter a valid email address.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.preferred_date)) return json({ ok: false, error: 'Please choose a valid date.' }, 400);
  if (data.consent !== true && data.consent !== 'on') {
    return json({ ok: false, error: 'Please agree to be contacted about your request.' }, 400);
  }
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
      return json({ ok: false, error: 'Sorry, that time was just booked. Please choose another time.' }, 409);
    }
    await createCalendarEvent(env, token, row, start, end);
  } catch (err) {
    console.error('calendar step failed', err);
    return json({ ok: false, error: 'We could not reserve that time. Please call us.' }, 500);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO bookings
        (name, phone, email, year, make, model, film, package, preferred_date, preferred_time, notes, consent, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'new')`
    ).bind(
      row.name, row.phone, row.email, row.year, row.make, row.model,
      row.film, row.package, row.preferred_date, row.preferred_time, row.notes
    ).run();
  } catch (err) {
    console.error('booking insert failed', err);
    return json({ ok: false, error: 'We could not save your request. Please call us.' }, 500);
  }

  try {
    await notifyByEmail(env, row, row.preferred_time);
  } catch (err) {
    console.error('email notification error', err);
  }
  try {
    await confirmToCustomer(env, row, row.preferred_time);
  } catch (err) {
    console.error('customer receipt error', err);
  }

  return json({ ok: true });
}
