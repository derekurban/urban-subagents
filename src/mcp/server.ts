import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import { BrokerCore } from "../broker/core.js";
import type { BrokerEnvironment, HostRuntime } from "../broker/types.js";
import { getBrokerEnvironment } from "../util/paths.js";

function toolText(result: unknown): string {
  return JSON.stringify(result, null, 2);
}

export function resolveMcpBrokerEnvironment(
  hostRuntime: HostRuntime = null,
): BrokerEnvironment {
  const current = getBrokerEnvironment();
  const runtime = hostRuntime ?? current.hostRuntime;

  return {
    hostRuntime: runtime,
    hostSessionId:
      current.hostSessionId ?? (runtime ? `host-${runtime}-${randomUUID()}` : null)
  };
}

export async function serveMcp(
  cwd = process.cwd(),
  hostRuntime: HostRuntime = null,
): Promise<void> {
  const broker = new BrokerCore(cwd, resolveMcpBrokerEnvironment(hostRuntime));
  const server = new McpServer({
    name: "urban-subagents",
    version: "0.1.0"
  });

  server.registerTool(
    "list_agents",
    {
      description:
        "List broker-managed subagent profiles. Use this instead of native host Agent or spawn_agent tooling.",
      inputSchema: {}
    },
    async () => {
      const result = broker.listAgents();
      return {
        content: [{ type: "text", text: toolText(result) }],
        structuredContent: { agents: result }
      };
    },
  );

  server.registerTool(
    "list_sessions",
    {
      description:
        "List broker-managed sessions. Default scope is current host session when available.",
      inputSchema: {
        scope: z.enum(["current", "all"]).optional(),
        limit: z.number().int().positive().max(500).optional(),
        agent: z.string().optional(),
        status: z
          .enum(["running", "idle", "completed", "failed", "interrupted"])
          .optional()
      }
    },
    async (args) => {
      const options: {
        scope?: "current" | "all";
        limit?: number;
        agent?: string;
        status?: "running" | "idle" | "completed" | "failed" | "interrupted";
      } = {};
      if (args.scope) {
        options.scope = args.scope;
      }
      if (args.limit !== undefined) {
        options.limit = args.limit;
      }
      if (args.agent) {
        options.agent = args.agent;
      }
      if (args.status) {
        options.status = args.status;
      }
      const result = broker.listSessions(options);
      return {
        content: [{ type: "text", text: toolText(result) }],
        structuredContent: { sessions: result }
      };
    },
  );

  server.registerTool(
    "delegate",
    {
      description:
        "Delegate work to a broker-managed child agent. Use this instead of the native Agent tool or native subagent APIs.",
      inputSchema: {
        agent: z.string(),
        prompt: z.string(),
        session_id: z.string().optional(),
        cwd: z.string().optional(),
        context: z.record(z.string(), z.unknown()).optional()
      }
    },
    async (args) => {
      const request: {
        agent: string;
        prompt: string;
        session_id?: string;
        cwd?: string;
        context?: Record<string, unknown>;
      } = {
        agent: args.agent,
        prompt: args.prompt
      };
      if (args.session_id) {
        request.session_id = args.session_id;
      }
      if (args.cwd) {
        request.cwd = args.cwd;
      }
      if (args.context) {
        request.context = args.context;
      }
      const result = await broker.delegate(request);
      return {
        content: [{ type: "text", text: toolText(result) }],
        structuredContent: { ...result }
      };
    },
  );

  server.registerTool(
    "cancel",
    {
      description: "Cancel an in-flight broker-managed session by session_id.",
      inputSchema: {
        session_id: z.string(),
        reason: z.string().optional()
      }
    },
    async ({ session_id, reason }) => {
      const result = await broker.cancel(session_id, reason);
      return {
        content: [{ type: "text", text: toolText(result) }],
        structuredContent: result
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const close = async () => {
    await server.close();
    broker.close();
  };

  process.on("SIGINT", () => void close().finally(() => process.exit(0)));
  process.on("SIGTERM", () => void close().finally(() => process.exit(0)));
}
