CREATE TABLE IF NOT EXISTS study_progress (
  email TEXT NOT NULL COLLATE NOCASE,
  deck_id TEXT NOT NULL CHECK (deck_id IN ('words1000', 'words2000')),
  progress_json TEXT NOT NULL,
  client_updated_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, deck_id)
);
