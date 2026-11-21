// Admin API: leads, quotes, bookings and losses by source, optionally for the last 30 or 90 days.
import { json, requireAdmin } from '../../lib/admin.js';

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const days = new URL(request.url).searchParams.get('days');
  const span = days === '30' || days === '90' ? Number(days) : 0;
  const where = span ? "WHERE created_at >= datetime('now', ?)" : '';
  const binds = span ? ['-' + span + ' days'] : [];

  const res = await env.DB.prepare(
    `SELECT source,
            COUNT(*) AS leads,
            SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END) AS quoted,
            SUM(CASE WHEN status IN ('booked', 'done') THEN 1 ELSE 0 END) AS booked,
            SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost
       FROM bookings ${where}
      GROUP BY source
      ORDER BY leads DESC`
  ).bind(...binds).all();

  return json({ ok: true, days: span || 'all', rows: res.results || [] });
}
