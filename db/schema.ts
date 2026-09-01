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

export const studyProgressSchemaSql = `CREATE TABLE IF NOT EXISTS study_progress (
  email TEXT NOT NULL COLLATE NOCASE,
  deck_id TEXT NOT NULL CHECK (deck_id IN ('words1000', 'words2000')),
  progress_json TEXT NOT NULL,
  client_updated_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, deck_id)
)`
