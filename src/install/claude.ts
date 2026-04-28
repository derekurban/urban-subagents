import type { BrokerLaunchConfig } from "./detect.js";

const CLAUDE_NATIVE_DELEGATION_TOOLS = [
  "Agent",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
] as const;

interface ClaudeSettings {
  permissions?: {
    deny?: string[];
  };
  hooks?: {
    PreToolUse?: Array<{
      matcher?: string;
      hooks?: Array<{
        type?: string;
        command?: string;
      }>;
    }>;
  };
  [key: string]: unknown;
}

interface ClaudeMcpServerConfig {
  command?: string;
  args?: string[];
  type?: string;
  url?: string;
  env?: Record<string, string>;
}

interface ClaudeMcpConfig {
  mcpServers?: Record<string, ClaudeMcpServerConfig>;
  [key: string]: unknown;
}

const CLAUDE_BLOCK_START = "<!-- urban-subagents -->";
const CLAUDE_BLOCK_END = "<!-- /urban-subagents -->";

export function mergeClaudeSettings(
  existing: ClaudeSettings,
  hookCommand: string,
): ClaudeSettings {
  const next: ClaudeSettings = structuredClone(existing);
  const deny = new Set(next.permissions?.deny ?? []);
  for (const tool of CLAUDE_NATIVE_DELEGATION_TOOLS) {
    deny.add(tool);
  }

  next.permissions = {
    ...(next.permissions ?? {}),
    deny: [...deny]
  };

  const preToolUse = [...(next.hooks?.PreToolUse ?? [])];
  const blockEntry = {
    matcher: "Agent",
    hooks: [
      {
        type: "command",
        command: hookCommand
      }
    ]
  };

  const existingIndex = preToolUse.findIndex((entry) => entry.matcher === "Agent");
  if (existingIndex >= 0) {
    preToolUse[existingIndex] = blockEntry;
  } else {
    preToolUse.push(blockEntry);
  }

  next.hooks = {
    ...(next.hooks ?? {}),
    PreToolUse: preToolUse
  };

  return next;
}

export function hasManagedClaudeDenyEntries(value: Record<string, unknown>): boolean {
  const permissions = value.permissions;
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
    return false;
  }

  const deny = (permissions as Record<string, unknown>).deny;
  if (!Array.isArray(deny)) {
    return false;
  }

  return CLAUDE_NATIVE_DELEGATION_TOOLS.every((tool) => deny.includes(tool));
}

export function mergeClaudeInstructions(existing: string): string {
  const block = `${CLAUDE_BLOCK_START}
## Delegation

Native Claude subagent delegation is disabled in this project. When the user asks you to delegate work, use a subagent, review code, create a plan, research in parallel, or split work into a child task, do not say delegation is unavailable.

Instead:
1. Call \`mcp__urban-subagents__list_agents\` to inspect the available broker-managed profiles.
2. Choose the best matching profile for the task.
3. Call \`mcp__urban-subagents__delegate\` with that \`agent\` name and a focused delegated prompt.
4. Treat the returned session as asynchronous. Poll \`mcp__urban-subagents__get_session\` or \`mcp__urban-subagents__list_sessions\` until the session is \`completed\`, \`failed\`, or \`interrupted\`.

Do not treat \`TaskCreate\`, \`TaskGet\`, \`TaskList\`, \`TaskOutput\`, \`TaskStop\`, or \`TaskUpdate\` as a replacement for broker delegation.
${CLAUDE_BLOCK_END}`;

  const pattern = new RegExp(
    `${CLAUDE_BLOCK_START}[\\s\\S]*?${CLAUDE_BLOCK_END}`,
    "m",
  );

  if (!existing.trim()) {
    return `${block}\n`;
  }

  if (pattern.test(existing)) {
    return existing.replace(pattern, block).trimEnd() + "\n";
  }

  return `${existing.trimEnd()}\n\n${block}\n`;
}

export function mergeClaudeMcpConfig(
  existing: ClaudeMcpConfig,
  launch: BrokerLaunchConfig,
): ClaudeMcpConfig {
  const next = structuredClone(existing);
  const mcpServers =
    next.mcpServers && typeof next.mcpServers === "object" && !Array.isArray(next.mcpServers)
      ? structuredClone(next.mcpServers)
      : {};
  const legacyEntry =
    next["urban-subagents"] &&
    typeof next["urban-subagents"] === "object" &&
    !Array.isArray(next["urban-subagents"])
      ? structuredClone(next["urban-subagents"] as ClaudeMcpServerConfig)
      : {};

  delete next["urban-subagents"];
  mcpServers["urban-subagents"] = {
    ...legacyEntry,
    command: launch.command,
    args: launch.args
  };
  next.mcpServers = mcpServers;

  return next;
}

export function hasManagedClaudeMcpServer(
  value: Record<string, unknown>,
): boolean {
  const mcpServers = value.mcpServers;
  if (!mcpServers || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    return false;
  }

  const server = (mcpServers as Record<string, unknown>)["urban-subagents"];
  if (!server || typeof server !== "object" || Array.isArray(server)) {
    return false;
  }

  const entry = server as ClaudeMcpServerConfig;
  return typeof entry.command === "string" && Array.isArray(entry.args);
}
