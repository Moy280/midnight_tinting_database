// Shared helpers for the admin API. Not a route: this file exports no onRequest handlers.
//
// Cloudflare Access sits in front of /admin and /api/admin/*. It only lets signed-in
// users through, and it passes their email in the Cf-Access-Authenticated-User-Email
// header. This check is a second line of defense: it also requires that email to be
// on the ADMIN_EMAILS list when that variable is set.

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

// Returns a Response to send back if the request is not from an allowed admin, else null.
export function requireAdmin(request, env) {
  const email = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
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
