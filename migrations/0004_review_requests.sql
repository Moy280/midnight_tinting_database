-- Review requests. Records when a review request was sent.
-- Existing Done bookings are marked as already sent, so no one gets an old request.
-- Apply once to the live database:
--   npx wrangler d1 execute midnight_tinting_booking --remote --file=migrations/0004_review_requests.sql
ALTER TABLE bookings ADD COLUMN review_sent_at TEXT;
UPDATE bookings SET review_sent_at = datetime('now') WHERE status = 'done';
