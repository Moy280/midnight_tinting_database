// Admin API: download every booking as a CSV file (opens in Excel or Google Sheets).
import { requireAdmin, csvCell, chicagoDate } from '../../lib/admin.js';

const COLUMNS = [
  'id', 'created_at', 'status', 'source', 'name', 'phone', 'email', 'year', 'make', 'model',
  'film', 'package', 'preferred_date', 'preferred_time', 'follow_up_date', 'reminder_sent_at',
  'notes', 'internal_notes', 'updated_at',
];

export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  const rows = await env.DB.prepare(
    'SELECT ' + COLUMNS.join(', ') + ' FROM bookings ORDER BY created_at DESC, id DESC'
  ).all();

  const lines = [COLUMNS.map(csvCell).join(',')];
  for (const r of rows.results || []) {
    lines.push(COLUMNS.map((c) => csvCell(r[c])).join(','));
  }
  const filename = 'bookings-' + chicagoDate(0) + '.csv';
  return new Response(lines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
    },
  });
}
