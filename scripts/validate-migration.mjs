import fs from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const migrationUrls = [
  new URL('../drizzle/0000_account_access.sql', import.meta.url),
  new URL('../drizzle/0001_study_progress.sql', import.meta.url),
  new URL('../drizzle/0002_sessions_and_progress_revision.sql', import.meta.url),
]
const sql = (await Promise.all(migrationUrls.map((url) => fs.readFile(url, 'utf8')))).join('\n')
const database = new DatabaseSync(':memory:')

try {
  database.exec(sql)

  const columns = database.prepare('PRAGMA table_info(account_access)').all()
  const indexes = database.prepare(
    `SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'account_access'`,
  ).all()
  const admins = database.prepare(
    `SELECT email, status, role FROM account_access WHERE role = 'admin' ORDER BY email`,
  ).all()
  const progressColumns = database.prepare('PRAGMA table_info(study_progress)').all()
  const progressIndexes = database.prepare(
    `SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'study_progress'`,
  ).all()
  const sessionColumns = database.prepare('PRAGMA table_info(user_sessions)').all()
  const sessionIndexes = database.prepare(
    `SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'user_sessions'`,
  ).all()
  const sessionQueryPlan = database.prepare(
    `EXPLAIN QUERY PLAN SELECT * FROM user_sessions WHERE email = ? ORDER BY started_at DESC`,
  ).all('learner@example.com')

  const requiredColumns = ['email', 'user_id', 'full_name', 'status', 'role', 'requested_at', 'reviewed_at', 'reviewed_by', 'last_seen_at']
  for (const column of requiredColumns) {
    if (!columns.some((entry) => entry.name === column)) throw new Error(`Missing column: ${column}`)
  }
  if (!indexes.some((entry) => entry.name === 'idx_account_access_status_requested')) {
    throw new Error('Missing account status index')
  }
  if (admins.length !== 2 || admins.some((admin) => admin.status !== 'approved')) {
    throw new Error(`Unexpected admin seeds: ${JSON.stringify(admins)}`)
  }
  for (const column of ['email', 'deck_id', 'progress_json', 'client_updated_at', 'server_revision', 'updated_at']) {
    if (!progressColumns.some((entry) => entry.name === column)) throw new Error(`Missing progress column: ${column}`)
  }
  if (!progressIndexes.some((entry) => String(entry.name).startsWith('sqlite_autoindex_study_progress'))) {
    throw new Error('Missing study progress primary index')
  }
  for (const column of ['email', 'session_id', 'started_at', 'last_active_at']) {
    if (!sessionColumns.some((entry) => entry.name === column)) throw new Error(`Missing session column: ${column}`)
  }
  if (!sessionIndexes.some((entry) => entry.name === 'idx_user_sessions_email_started')) {
    throw new Error('Missing user session lookup index')
  }
  if (!sessionQueryPlan.some((entry) => String(entry.detail).includes('idx_user_sessions_email_started'))) {
    throw new Error(`User session index is not used: ${JSON.stringify(sessionQueryPlan)}`)
  }

  console.log(JSON.stringify({
    valid: true,
    admins: admins.map((admin) => admin.email),
    indexed: true,
    progressSync: true,
    sessionHistory: true,
  }, null, 2))
} finally {
  database.close()
}
