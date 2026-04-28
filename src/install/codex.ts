import type { AgentProfile } from "../broker/types.js";
import { stringifyToml } from "../util/toml.js";
import type { BrokerLaunchConfig } from "./detect.js";

type TomlRecord = Record<string, unknown>;

function asRecord(value: unknown): TomlRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as TomlRecord)
    : {};
}

export function mergeCodexConfig(
  existing: TomlRecord,
  agents: AgentProfile[],
  launch: BrokerLaunchConfig,
): TomlRecord {
  const next = structuredClone(existing);
  const features = asRecord(next.features);
  const brokerAgents = asRecord(next.agents);
  const mcpServers = asRecord(next.mcp_servers);
  const profiles = asRecord(next.profiles);

  features.multi_agent = false;

  brokerAgents.max_depth = 1;
  brokerAgents.max_threads = 1;

  mcpServers["urban-subagents"] = {
    command: launch.command,
    args: launch.args
  };

  for (const agent of agents) {
    profiles[agent.name] = {
      model: agent.model,
      model_reasoning_effort: agent.codex.reasoningEffort,
      sandbox_mode: agent.codex.sandboxMode,
      approval_policy: agent.codex.approvalPolicy
    };
  }

  next.features = features;
  next.agents = brokerAgents;
  next.mcp_servers = mcpServers;
  next.profiles = profiles;

  return next;
}

const AGENTS_BLOCK_START = "<!-- urban-subagents -->";
const AGENTS_BLOCK_END = "<!-- /urban-subagents -->";

export function mergeCodexAgentsMarkdown(existing: string): string {
  const block = `${AGENTS_BLOCK_START}
## Subagent Delegation

Native subagent dispatch is disabled on this machine. When the user asks you to delegate work, use a subagent, review code, create a plan, research in parallel, or split work into a child task, use the broker MCP tools instead of native multi-agent APIs.

Required flow:
1. Run \`mcp__urban-subagents__list_agents\` to inspect available profiles.
2. Choose the best matching profile.
3. Run \`mcp__urban-subagents__delegate\` with that \`agent\` name and a focused delegated prompt.
4. The delegate call returns a running session immediately. Poll \`mcp__urban-subagents__get_session\` or \`mcp__urban-subagents__list_sessions\` until the session is \`completed\`, \`failed\`, or \`interrupted\`.

Do not claim delegation is unavailable when the broker MCP tools are present.
Do not use \`spawn_agent\`, \`send_input\`, \`resume_agent\`, \`wait_agent\`, or \`close_agent\`.
${AGENTS_BLOCK_END}`;

  const pattern = new RegExp(
    `${AGENTS_BLOCK_START}[\\s\\S]*?${AGENTS_BLOCK_END}`,
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

export function renderCodexConfig(value: TomlRecord): string {
  return stringifyToml(value);
}
