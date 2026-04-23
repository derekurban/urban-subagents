import { describe, expect, it } from "vitest";

import {
  hasManagedClaudeDenyEntries,
  hasManagedClaudeMcpServer,
  mergeClaudeInstructions,
  mergeClaudeMcpConfig,
  mergeClaudeSettings,
} from "../../src/install/claude.js";
import { mergeCodexAgentsMarkdown, mergeCodexConfig } from "../../src/install/codex.js";

describe("install helpers", () => {
  it("adds the Claude Agent deny and hook", () => {
    const merged = mergeClaudeSettings({}, "node hook.js");
    expect(merged.permissions?.deny).toContain("Agent");
    expect(merged.permissions?.deny).toContain("TaskCreate");
    expect(hasManagedClaudeDenyEntries(merged)).toBe(true);
    expect(merged.hooks?.PreToolUse?.[0]?.matcher).toBe("Agent");
  });

  it("adds managed Claude delegation instructions", () => {
    const merged = mergeClaudeInstructions("");
    expect(merged).toContain("mcp__urban-subagents__list_agents");
    expect(merged).toContain("mcp__urban-subagents__delegate");
    expect(merged).toContain("Do not treat `TaskCreate`");
  });

  it("writes the Claude MCP server under mcpServers", () => {
    const merged = mergeClaudeMcpConfig(
      {
        "urban-subagents": {
          command: "old-broker",
          args: ["serve-mcp"]
        }
      },
      {
        command: "agent-broker",
        args: ["serve-mcp", "--host-runtime", "claude"]
      },
    );

    expect(merged).not.toHaveProperty("urban-subagents");
    expect(merged.mcpServers?.["urban-subagents"]).toEqual({
      command: "agent-broker",
      args: ["serve-mcp", "--host-runtime", "claude"]
    });
    expect(hasManagedClaudeMcpServer(merged)).toBe(true);
  });

  it("adds the Codex managed block and mcp server", () => {
    const merged = mergeCodexConfig(
      {},
      [
        {
          name: "reviewer",
          description: "review",
          runtime: "codex_exec",
          model: "gpt-5.4",
          prompt_file: "prompts/reviewer.md",
          promptFilePath: "prompts/reviewer.md",
          permissions: ["read-only"],
          supports_resume: true,
          claude: {
            tools: ["Read"],
            permissionMode: "bypassPermissions",
            effort: "high"
          },
          codex: {
            sandboxMode: "read-only",
            approvalPolicy: "never",
            reasoningEffort: "high"
          }
        }
      ],
      {
        command: "agent-broker",
        args: ["serve-mcp"]
      },
    );

    expect((merged.features as Record<string, unknown>).multi_agent).toBe(false);
    expect((merged.agents as Record<string, unknown>).max_depth).toBe(1);
    expect((merged.agents as Record<string, unknown>).max_threads).toBe(1);
    expect(
      ((merged.mcp_servers as Record<string, unknown>)["urban-subagents"] as Record<string, unknown>).command,
    ).toBe("agent-broker");
    expect(mergeCodexAgentsMarkdown("")).toContain("mcp__urban-subagents__delegate");
    expect(mergeCodexAgentsMarkdown("")).toContain("Do not claim delegation is unavailable");
  });
});
