import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";

import { openDatabase } from "../../src/store/db.js";
import { SessionStore } from "../../src/store/sessions.js";

describe("SessionStore", () => {
  const homes: string[] = [];

  afterEach(() => {
    for (const home of homes.splice(0)) {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("creates and lists sessions", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "urban-store-"));
    homes.push(home);
    process.env.URBAN_SUBAGENTS_HOME = home;

    const db = openDatabase(process.cwd());
    const store = new SessionStore(db);
    store.createRunningSession({
      session_id: "session-1",
      provider_handle: "session-1",
      runtime: "claude_code",
      parent_session_id: "parent-1",
      parent_runtime: "claude",
      agent: "planner",
      cwd: process.cwd(),
      pid: 1234
    });
    store.markSession("session-1", "completed", {
      durationMs: 100,
      result: "done"
    });

    const sessions = store.listSessions({ scope: "all" });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("completed");
    db.close();
  });

  it("marks orphaned running sessions as interrupted", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "urban-orphan-"));
    homes.push(home);
    process.env.URBAN_SUBAGENTS_HOME = home;

    const db = openDatabase(process.cwd());
    const store = new SessionStore(db);
    store.createRunningSession({
      session_id: "session-2",
      provider_handle: "session-2",
      runtime: "codex_exec",
      parent_session_id: "parent-2",
      parent_runtime: "codex",
      agent: "reviewer",
      cwd: process.cwd(),
      pid: 999999
    });

    expect(store.orphanCleanup()).toBe(1);
    expect(store.getSession("session-2")?.status).toBe("interrupted");
    db.close();
  });

  it("migrates legacy provider_handle NOT NULL sessions", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "urban-migrate-"));
    homes.push(home);
    process.env.URBAN_SUBAGENTS_HOME = home;
    fs.mkdirSync(home, { recursive: true });

    const legacy = new Database(path.join(home, "sessions.db"));
    legacy.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        provider_handle TEXT NOT NULL,
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
      CREATE TABLE session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT
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
        updated_at
      ) VALUES (
        'session-legacy',
        'provider-legacy',
        'codex_exec',
        NULL,
        NULL,
        'reviewer',
        'completed',
        '.',
        1,
        1
      );
      INSERT INTO session_events (session_id, ts, kind, payload)
      VALUES ('session-legacy', 1, 'start', NULL);
    `);
    legacy.close();

    const db = openDatabase(process.cwd());
    const column = db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .find((entry) => (entry as { name: string }).name === "provider_handle") as
      | { notnull: number }
      | undefined;
    expect(column?.notnull).toBe(0);

    const store = new SessionStore(db);
    expect(store.getSession("session-legacy")?.provider_handle).toBe("provider-legacy");
    db.close();
  });
});
