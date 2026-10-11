import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './env.ts';

export const db = new DatabaseSync(path.join(DATA_DIR, 'com-factory.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT '',
  facts TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  languages TEXT NOT NULL DEFAULT '[]',
  voice TEXT NOT NULL DEFAULT '',
  mention_rules TEXT NOT NULL DEFAULT '',
  never TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  stats TEXT NOT NULL DEFAULT '{}',
  log TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  post_id TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  author_followers INTEGER NOT NULL DEFAULT 0,
  author_verified INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  lang TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  post_created_at TEXT,
  discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
  run_id INTEGER,
  metrics TEXT NOT NULL DEFAULT '{}',
  score TEXT NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL DEFAULT 'new',
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE(platform, post_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_decision ON candidates(platform, decision);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  text TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  mentions_product INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT,
  reply_id TEXT,
  reply_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(platform, status);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  post_id TEXT NOT NULL DEFAULT '',
  post_url TEXT NOT NULL DEFAULT '',
  reply_id TEXT NOT NULL DEFAULT '',
  reply_url TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  bucket TEXT NOT NULL DEFAULT '',
  product_mentioned INTEGER NOT NULL DEFAULT 0,
  link_included INTEGER NOT NULL DEFAULT 0,
  posted_at TEXT NOT NULL DEFAULT (datetime('now')),
  run_id INTEGER,
  metrics TEXT NOT NULL DEFAULT '{}',
  metrics_at TEXT,
  source TEXT NOT NULL DEFAULT 'runner'
);
CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments(platform, posted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_reply ON comments(platform, reply_id) WHERE reply_id <> '';

CREATE TABLE IF NOT EXISTS inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  external_id TEXT NOT NULL DEFAULT '',
  from_user TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '',
  post_url TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled INTEGER NOT NULL DEFAULT 0,
  our_reply TEXT NOT NULL DEFAULT '',
  UNIQUE(platform, external_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  platform TEXT PRIMARY KEY,
  until TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stop_authors (
  platform TEXT NOT NULL,
  author TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (platform, author)
);
`);

// Additive migrations (safe to re-run).
function addColumn(table: string, column: string, ddl: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
// v0.1 created drafts.candidate_id as NOT NULL; inbound replies have no candidate, so rebuild once.
{
  const cand = (db.prepare('PRAGMA table_info(drafts)').all() as any[]).find((c) => c.name === 'candidate_id');
  if (cand && cand.notnull) {
    db.exec(`BEGIN;
      CREATE TABLE drafts_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id INTEGER REFERENCES candidates(id) ON DELETE CASCADE,
        platform TEXT NOT NULL, text TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', mentions_product INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
        posted_at TEXT, reply_id TEXT, reply_url TEXT);
      INSERT INTO drafts_new(id, candidate_id, platform, text, model, mentions_product, status, error, created_at, posted_at, reply_id, reply_url)
        SELECT id, candidate_id, platform, text, model, mentions_product, status, error, created_at, posted_at, reply_id, reply_url FROM drafts;
      DROP TABLE drafts; ALTER TABLE drafts_new RENAME TO drafts;
      CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(platform, status);
      COMMIT;`);
  }
}
addColumn('products', 'platforms', `TEXT NOT NULL DEFAULT '["x","threads"]'`);
addColumn('products', 'queries', `TEXT NOT NULL DEFAULT '[]'`);
addColumn('candidates', 'kind', `TEXT NOT NULL DEFAULT ''`);
addColumn('candidates', 'product_id', 'INTEGER');
addColumn('drafts', 'link_included', 'INTEGER NOT NULL DEFAULT 0');
addColumn('drafts', 'inbound_id', 'INTEGER');
addColumn('drafts', 'product_id', 'INTEGER');
addColumn('comments', 'product_id', 'INTEGER');
addColumn('inbound', 'context', `TEXT NOT NULL DEFAULT ''`);
addColumn('inbound', 'confidence', 'REAL NOT NULL DEFAULT 0');
addColumn('inbound', 'product_id', 'INTEGER');
addColumn('inbound', 'comment_id', 'INTEGER');
addColumn('inbound', 'turns', 'INTEGER NOT NULL DEFAULT 0');

export type Row = Record<string, any>;

export function all(sql: string, ...params: any[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}
export function get(sql: string, ...params: any[]): Row | undefined {
  return db.prepare(sql).get(...params) as Row | undefined;
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
export function j<T = any>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}
