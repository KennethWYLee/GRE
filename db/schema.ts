export const accountAccessSchemaSql = `CREATE TABLE IF NOT EXISTS account_access (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  last_seen_at TEXT
)`

export const accountAccessStatusIndexSql = `CREATE INDEX IF NOT EXISTS idx_account_access_status_requested
ON account_access(status, requested_at)`
