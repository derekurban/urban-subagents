import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  getBrokerCliArgs,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  runBrokerCliJson,
} from "../support/harness.js";

const acceptanceIt =
  isAcceptanceEnabled() && getEnabledProviders().length > 0 ? it : it.skip;

describe("phase 1 real MCP acceptance", () => {
  acceptanceIt("serves broker tools over stdio and completes a real delegate round-trip", async () => {
    const context = createAcceptanceContext("mcp");
    try {
      const provider = context.enabledProviders[0]!;
      const agent = getDefaultAgentForProvider(provider);

      await runBrokerCliJson(context, ["init", "--host", provider, "--force", "--json"]);

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: getBrokerCliArgs(["serve-mcp"]),
        cwd: context.workspaceDir,
        env: context.env as Record<string, string>,
        stderr: "pipe"
      });

      const client = new Client({
        name: "urban-subagents-acceptance",
        version: "0.1.0"
      });

      await client.connect(transport);
      try {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["list_agents", "list_sessions", "delegate", "cancel"]),
        );

        const response = await client.callTool({
          name: "delegate",
          arguments: {
            agent,
            prompt: "Reply with a short MCP acceptance confirmation."
          }
        });

        const responseText = JSON.stringify(response.structuredContent ?? response.content ?? response);
        expect(responseText.length).toBeGreaterThan(0);
        expect(responseText).toContain("session_id");
      } finally {
        await transport.close();
      }
    } finally {
      context.cleanup();
    }
  });
});
