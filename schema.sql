-- Booking requests table (D1 / SQLite).
-- Apply with: npx wrangler d1 execute midnight-bookings --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  year TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  film TEXT NOT NULL,
  package TEXT NOT NULL,
  preferred_date TEXT NOT NULL,
  preferred_time TEXT,
  notes TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  source TEXT NOT NULL DEFAULT 'Website',
  internal_notes TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status, created_at);
