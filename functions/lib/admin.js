// Shared helpers for the admin API. Not a route: this file exports no onRequest handlers.
//
// Cloudflare Access sits in front of /admin and /api/admin/*. It only lets signed-in
// users through. Each request then carries a signed token (Cf-Access-Jwt-Assertion).
// We check that token's signature against Cloudflare's published keys, so the email
// we read from it cannot be faked. ADMIN_EMAILS, when set, is a second allowlist.

export const STATUSES = ['new', 'contacted', 'quoted', 'booked', 'done', 'lost'];
export const SOURCES = ['Website', 'Phone', 'Referral', 'Other'];

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function clean(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

// Returns a YYYY-MM-DD string or null.
export function dateOrNull(v) {
  const s = clean(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// One CSV cell. Quotes every value, and neutralises leading characters that spreadsheets
// would otherwise read as formulas (=, +, -, @), so an entry cannot run code when opened.
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

// Today's date in Chicago, as YYYY-MM-DD, offset by a number of days.
export function chicagoDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const certCache = { keys: null, fetchedAt: 0, team: '' };

function b64urlToBytes(s) {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

function decodePart(part) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));
}

async function getCertKeys(team) {
  const fresh = Date.now() - certCache.fetchedAt < 60 * 60 * 1000;
  if (certCache.keys && fresh && certCache.team === team) return certCache.keys;
  const res = await fetch('https://' + team + '/cdn-cgi/access/certs');
  if (!res.ok) throw new Error('Access certs request failed: ' + res.status);
  const body = await res.json();
  certCache.keys = body.keys || [];
  certCache.fetchedAt = Date.now();
  certCache.team = team;
  return certCache.keys;
}

// Returns the verified email from an Access token, or null if the token is not valid.
export async function verifyAccessToken(token, env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return null;

  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  let header;
  let payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256') return null;

  const keys = await getCertKeys(team);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), signed);
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== 'https://' + team) return null;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return null;

  return String(payload.email || '').trim().toLowerCase() || null;
}

// Returns a Response to send back if the request is not from an allowed admin, else null.
export async function requireAdmin(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || '';
  let email = null;
  if (token) {
    try {
      email = await verifyAccessToken(token, env);
    } catch (err) {
      console.error('Access token check failed', err);
    }
  }
  if (!email) return json({ ok: false, error: 'Not signed in.' }, 403);

  const allowed = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(email)) {
    return json({ ok: false, error: 'This account is not allowed to use the admin.' }, 403);
  }
  return null;
}
