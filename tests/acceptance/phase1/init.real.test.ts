import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acceptanceHostForProviders,
  createAcceptanceContext,
  getEnabledProviders,
  isAcceptanceEnabled,
  runBrokerCliJson,
} from "../support/harness.js";

interface InitPreviewResult {
  dry_run: true;
  preview: string[];
}

interface InitApplyResult {
  dry_run: false;
  written_files: string[];
}

const acceptanceIt =
  isAcceptanceEnabled() && getEnabledProviders().length > 0 ? it : it.skip;

describe("phase 1 real init acceptance", () => {
  acceptanceIt("writes managed config into an isolated scratch environment", async () => {
    const context = createAcceptanceContext("init");
    try {
      const host = acceptanceHostForProviders(context.enabledProviders);
      const preview = await runBrokerCliJson<InitPreviewResult>(context, [
        "init",
        "--host",
        host,
        "--dry-run",
        "--force",
        "--json"
      ]);

      expect(preview.dry_run).toBe(true);
      expect(preview.preview.length).toBeGreaterThan(0);

      const applied = await runBrokerCliJson<InitApplyResult>(context, [
        "init",
        "--host",
        host,
        "--force",
        "--json"
      ]);

      expect(applied.dry_run).toBe(false);
      expect(applied.written_files.length).toBeGreaterThan(0);

      const rerun = await runBrokerCliJson<InitApplyResult>(context, [
        "init",
        "--host",
        host,
        "--force",
        "--json"
      ]);

      expect([...rerun.written_files].sort()).toEqual([...applied.written_files].sort());

      expect(fs.existsSync(path.join(context.urbanHomeDir, "config.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(context.urbanHomeDir, "prompts", "reviewer.md"))).toBe(true);
      expect(fs.existsSync(path.join(context.urbanHomeDir, "prompts", "planner.md"))).toBe(true);
      expect(fs.existsSync(path.join(context.urbanHomeDir, "sessions.db"))).toBe(true);

      if (host === "all" || host === "claude") {
        expect(fs.existsSync(path.join(context.workspaceDir, ".claude", "CLAUDE.md"))).toBe(true);
        expect(fs.existsSync(path.join(context.workspaceDir, ".claude", "settings.json"))).toBe(true);
        expect(fs.existsSync(path.join(context.workspaceDir, ".mcp.json"))).toBe(true);
        const claudeMcp = JSON.parse(
          fs.readFileSync(path.join(context.workspaceDir, ".mcp.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(
          ((claudeMcp.mcpServers as Record<string, unknown>)["urban-subagents"] as Record<string, unknown>).args,
        ).toContain("--host-runtime");
        expect(
          ((claudeMcp.mcpServers as Record<string, unknown>)["urban-subagents"] as Record<string, unknown>).args,
        ).toContain("claude");
      }

      if (host === "all" || host === "codex") {
        expect(fs.existsSync(path.join(context.codexHomeDir, "config.toml"))).toBe(true);
        expect(fs.existsSync(path.join(context.codexHomeDir, "AGENTS.md"))).toBe(true);
        const codexConfig = fs.readFileSync(
          path.join(context.codexHomeDir, "config.toml"),
          "utf8",
        );
        expect(codexConfig).toContain("--host-runtime");
        expect(codexConfig).toContain("codex");
      }
    } finally {
      context.cleanup();
    }
  });
});
