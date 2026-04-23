import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { SESSION_SCHEMA_SQL } from "./schema.js";
import { getStatePaths } from "../util/paths.js";

export function openDatabase(cwd = process.cwd()): Database.Database {
  const { dbPath } = getStatePaths(cwd);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SESSION_SCHEMA_SQL);

  return db;
}
