import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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
});
