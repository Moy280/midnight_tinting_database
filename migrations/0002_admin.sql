-- Admin support: where a booking came from, internal notes, and when it last changed.
-- Apply once to the live database:
--   npx wrangler d1 execute midnight-bookings --remote --file=migrations/0002_admin.sql
ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'Website';
ALTER TABLE bookings ADD COLUMN internal_notes TEXT;
ALTER TABLE bookings ADD COLUMN updated_at TEXT;
