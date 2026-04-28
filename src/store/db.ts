import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { SESSION_SCHEMA_SQL } from "./schema.js";
import { getStatePaths } from "../util/paths.js";

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function migrateNullableProviderHandle(db: Database.Database): void {
  if (!hasTable(db, "sessions")) {
    return;
  }

  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  const providerHandle = columns.find((column) => column.name === "provider_handle");
  if (!providerHandle || providerHandle.notnull === 0) {
    return;
  }

  const hasEvents = hasTable(db, "session_events");
  db.pragma("foreign_keys = OFF");
  try {
    db.exec(`
      ${hasEvents ? "ALTER TABLE session_events RENAME TO session_events_legacy;" : ""}
      ALTER TABLE sessions RENAME TO sessions_legacy;

      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        provider_handle TEXT,
        runtime TEXT NOT NULL,
        parent_session_id TEXT,
        parent_runtime TEXT,
        agent TEXT NOT NULL,
        status TEXT NOT NULL,
        cwd TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ended_at INTEGER,
        pid INTEGER,
        duration_ms INTEGER,
        result TEXT,
        error TEXT
      );

      INSERT INTO sessions (
        session_id,
        provider_handle,
        runtime,
        parent_session_id,
        parent_runtime,
        agent,
        status,
        cwd,
        created_at,
        updated_at,
        ended_at,
        pid,
        duration_ms,
        result,
        error
      )
      SELECT
        session_id,
        provider_handle,
        runtime,
        parent_session_id,
        parent_runtime,
        agent,
        status,
        cwd,
        created_at,
        updated_at,
        ended_at,
        pid,
        duration_ms,
        result,
        error
      FROM sessions_legacy;

      ${
        hasEvents
          ? `
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT
      );

      INSERT INTO session_events (id, session_id, ts, kind, payload)
      SELECT id, session_id, ts, kind, payload
      FROM session_events_legacy;

      DROP TABLE session_events_legacy;
      `
          : ""
      }

      DROP TABLE sessions_legacy;
    `);
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function openDatabase(cwd = process.cwd()): Database.Database {
  const { dbPath } = getStatePaths(cwd);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrateNullableProviderHandle(db);
  db.exec(SESSION_SCHEMA_SQL);

  return db;
}
