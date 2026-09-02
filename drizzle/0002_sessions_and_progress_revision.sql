ALTER TABLE study_progress
ADD COLUMN server_revision INTEGER NOT NULL DEFAULT 0;

UPDATE study_progress
SET server_revision = 1
WHERE server_revision = 0;

CREATE TABLE IF NOT EXISTS user_sessions (
  email TEXT NOT NULL COLLATE NOCASE,
  session_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, session_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_email_started
ON user_sessions(email, started_at DESC);

PRAGMA optimize;
