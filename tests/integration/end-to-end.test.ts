import { describe, expect, it } from "vitest";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { runInit } from "../../src/install/index.js";

describe("broker MCP end-to-end", () => {
  it("serves MCP tools and delegates through them", async () => {
    await runInit({
      cwd: process.cwd(),
      host: "all",
      force: true
    });

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        path.resolve("node_modules", "tsx", "dist", "cli.mjs"),
        path.resolve("src", "cli", "index.ts"),
        "serve-mcp"
      ],
      cwd: process.cwd(),
      env: {
        ...process.env,
        URBAN_SUBAGENTS_HOME: process.env.URBAN_SUBAGENTS_HOME ?? "",
        CODEX_HOME: process.env.CODEX_HOME ?? ""
      } as Record<string, string>,
      stderr: "pipe"
    });

    const client = new Client({
      name: "test-client",
      version: "0.1.0"
    });

    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_agents",
        "list_sessions",
        "delegate",
        "cancel"
      ]),
    );

    const delegate = await client.callTool({
      name: "delegate",
      arguments: {
        agent: "reviewer",
        prompt: "Inspect the workspace"
      }
    });
    const sessionId = (
      delegate as { structuredContent?: { session_id?: string; status?: string } }
    ).structuredContent?.session_id;
    expect(sessionId).toBeTruthy();
    expect(
      (delegate as { structuredContent?: { status?: string } }).structuredContent?.status,
    ).toBe("running");

    const deadline = Date.now() + 30000;
    let completed: unknown = null;
    while (Date.now() < deadline) {
      const session = await client.callTool({
        name: "get_session",
        arguments: {
          session_id: sessionId
        }
      });
      const structured = (
        session as { structuredContent?: { status?: string; result?: string; error?: string } }
      ).structuredContent;
      if (structured?.status === "completed") {
        completed = session;
        break;
      }
      if (structured?.status === "failed" || structured?.status === "interrupted") {
        throw new Error(`Session ended with ${structured.status}: ${structured.error ?? ""}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(JSON.stringify(completed)).toContain("Codex handled");

    await transport.close();
  });
});
