import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runClaudeDelegate } from "../../src/adapters/claude.js";
import { runCodexDelegate } from "../../src/adapters/codex.js";
import { openDatabase } from "../../src/store/db.js";
import { SessionStore } from "../../src/store/sessions.js";

function makeProfile(runtime: "claude_code" | "codex_exec") {
  const promptFilePath = path.resolve("prompts", runtime === "claude_code" ? "planner.md" : "reviewer.md");
  return {
    name: runtime === "claude_code" ? "planner" : "reviewer",
    description: "test profile",
    runtime,
    model: runtime === "claude_code" ? "opus" : "gpt-5.4",
    prompt_file: promptFilePath,
    promptFilePath,
    permissions: ["read-only"],
    supports_resume: true as const,
    claude: {
      tools: ["Read"],
      permissionMode: "bypassPermissions" as const,
      effort: "high" as const
    },
    codex: {
      sandboxMode: "read-only" as const,
      approvalPolicy: "never" as const,
      reasoningEffort: "high" as const
    }
  };
}

describe("provider adapters", () => {
  it("runs the Claude adapter against the mock CLI", async () => {
    const db = openDatabase(process.cwd());
    const store = new SessionStore(db);
    const result = await runClaudeDelegate({
      profile: makeProfile("claude_code"),
      request: {
        agent: "planner",
        prompt: "Review this"
      },
      cwd: process.cwd(),
      brokerEnvironment: {
        hostSessionId: "host-1",
        hostRuntime: "claude"
      },
      sessionStore: store
    });

    expect(result.session_id).toBeTruthy();
    expect(result.result).toContain("Claude handled");
    db.close();
  });

  it("runs the Codex adapter against the mock CLI", async () => {
    const db = openDatabase(process.cwd());
    const store = new SessionStore(db);
    const result = await runCodexDelegate({
      profile: makeProfile("codex_exec"),
      request: {
        agent: "reviewer",
        prompt: "Inspect this"
      },
      cwd: process.cwd(),
      brokerEnvironment: {
        hostSessionId: "host-2",
        hostRuntime: "codex"
      },
      sessionStore: store
    });

    expect(result.session_id).toBeTruthy();
    expect(result.result).toContain("Codex handled");
    db.close();
  });
});
