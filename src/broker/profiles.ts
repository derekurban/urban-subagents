import fs from "node:fs";

import type {
  AgentProfile,
  BrokerConfig,
  ClaudeProfileDefaults,
  CodexProfileDefaults,
  ReasoningEffort,
} from "./types.js";
import { resolvePromptPath } from "../util/paths.js";

function isReadOnlyAgent(name: string): boolean {
  return /review|plan|research|audit|explore|docs/i.test(name);
}

function toClaudeEffort(effort: ReasoningEffort | undefined): ClaudeProfileDefaults["effort"] {
  if (effort === "minimal") {
    return "low";
  }

  return effort ?? "high";
}

function toCodexEffort(effort: ReasoningEffort | undefined): CodexProfileDefaults["reasoningEffort"] {
  if (effort === "max") {
    return "xhigh";
  }

  return effort ?? "high";
}

function buildClaudeDefaults(name: string, effort: ReasoningEffort | undefined): ClaudeProfileDefaults {
  if (isReadOnlyAgent(name)) {
    return {
      tools: ["Read", "LS", "Glob", "Grep"],
      permissionMode: "bypassPermissions",
      effort: toClaudeEffort(effort)
    };
  }

  return {
    tools: ["Read", "LS", "Glob", "Grep", "Edit", "MultiEdit", "Write", "Bash"],
    permissionMode: "bypassPermissions",
    effort: toClaudeEffort(effort)
  };
}

function buildCodexDefaults(name: string, effort: ReasoningEffort | undefined): CodexProfileDefaults {
  if (isReadOnlyAgent(name)) {
    return {
      sandboxMode: "read-only",
      approvalPolicy: "never",
      reasoningEffort: toCodexEffort(effort)
    };
  }

  return {
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    reasoningEffort: toCodexEffort(effort)
  };
}

function buildPermissions(name: string): string[] {
  return isReadOnlyAgent(name)
    ? ["read-only", "no-recursive-delegation"]
    : ["workspace-write", "no-recursive-delegation"];
}

export function resolveAgentProfiles(config: BrokerConfig): AgentProfile[] {
  return Object.entries(config.agents).map(([name, agent]) => {
    const promptFilePath = resolvePromptPath(config.path, agent.prompt_file);
    if (!fs.existsSync(promptFilePath)) {
      throw new Error(
        `Prompt file for agent "${name}" does not exist: ${promptFilePath}`,
      );
    }

    return {
      ...agent,
      name,
      promptFilePath,
      permissions: buildPermissions(name),
      supports_resume: true,
      claude: buildClaudeDefaults(name, agent.reasoning_effort),
      codex: buildCodexDefaults(name, agent.reasoning_effort)
    };
  });
}

export function getAgentProfile(config: BrokerConfig, name: string): AgentProfile {
  const profile = resolveAgentProfiles(config).find((item) => item.name === name);
  if (!profile) {
    throw new Error(`Unknown agent profile "${name}".`);
  }

  return profile;
}
