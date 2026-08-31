CREATE TABLE IF NOT EXISTS account_access (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_account_access_status_requested
ON account_access(status, requested_at);

INSERT INTO account_access (email, status, role, requested_at, reviewed_at, reviewed_by)
VALUES ('wy.lee@ntub.edu.tw', 'approved', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system')
ON CONFLICT(email) DO UPDATE SET status = 'approved', role = 'admin';

INSERT INTO account_access (email, status, role, requested_at, reviewed_at, reviewed_by)
VALUES ('kenneth.wy.lee21@gmail.com', 'approved', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'system')
ON CONFLICT(email) DO UPDATE SET status = 'approved', role = 'admin';
