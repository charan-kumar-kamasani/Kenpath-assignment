import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dir, { recursive: true });

export const db = new DatabaseSync(path.join(dir, 'rythu.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, name_te TEXT NOT NULL, role TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY, ref_no TEXT UNIQUE NOT NULL,
  farmer_name TEXT NOT NULL, father_name TEXT, village TEXT NOT NULL, mandal TEXT NOT NULL,
  phone TEXT, survey_no TEXT NOT NULL, area_ha REAL NOT NULL,
  crop TEXT NOT NULL, irrigation TEXT NOT NULL, calamity TEXT NOT NULL, calamity_date TEXT NOT NULL,
  aadhaar_last4 TEXT, account_last4 TEXT,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',        -- pending | returned | approved | rejected
  current_step INTEGER NOT NULL DEFAULT 1,       -- 1 docs, 2 field inspection, 3 eligibility, 4 decision
  docs TEXT NOT NULL DEFAULT '[]',
  verification TEXT, inspection TEXT, eligibility TEXT, decision TEXT,
  ai_flags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, application_id INTEGER NOT NULL REFERENCES applications(id),
  at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, step INTEGER,
  detail TEXT, ai_source TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_app ON events(application_id);
`);

const JSON_COLS = ['docs', 'verification', 'inspection', 'eligibility', 'decision', 'ai_flags'];

export function hydrate(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLS) out[c] = row[c] ? JSON.parse(row[c]) : c === 'docs' || c === 'ai_flags' ? [] : null;
  return out;
}

export const getApp = (id) => hydrate(db.prepare('SELECT * FROM applications WHERE id = ?').get(id));
export const listApps = () => db.prepare('SELECT * FROM applications').all().map(hydrate);

export function saveApp(id, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE applications SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => (JSON_COLS.includes(k) && fields[k] != null ? JSON.stringify(fields[k]) : fields[k])), id);
}

export function addEvent(applicationId, { actor, action, step = null, detail = null, ai_source = null, at }) {
  db.prepare('INSERT INTO events (application_id, at, actor, action, step, detail, ai_source) VALUES (?,?,?,?,?,?,?)')
    .run(applicationId, at || new Date().toISOString(), actor, action, step, detail ? JSON.stringify(detail) : null, ai_source);
}

export const getEvents = (applicationId) =>
  db.prepare('SELECT * FROM events WHERE application_id = ? ORDER BY at ASC, id ASC').all(applicationId)
    .map((e) => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
