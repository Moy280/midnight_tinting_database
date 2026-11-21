-- Follow-up dates and appointment reminders.
-- Apply once to the live database:
--   npx wrangler d1 execute midnight_tinting_booking --remote --file=migrations/0003_followup_reminders.sql
ALTER TABLE bookings ADD COLUMN follow_up_date TEXT;
ALTER TABLE bookings ADD COLUMN reminder_sent_at TEXT;
