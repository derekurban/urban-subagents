import fs from "node:fs";

import YAML from "yaml";
import { z } from "zod";

import type { BrokerConfig, RawBrokerConfig } from "./types.js";
import { getStatePaths } from "../util/paths.js";

const rawAgentProfileSchema = z.object({
  description: z.string().min(1),
  runtime: z.enum(["claude_code", "codex_exec"]),
  model: z.string().min(1),
  prompt_file: z.string().min(1)
});

const rawConfigSchema = z.object({
  version: z.union([z.string(), z.number()]).optional(),
  broker: z
    .object({
      execution_mode: z.literal("sync").optional(),
      default_output: z
        .object({
          format: z.literal("text").optional()
        })
        .optional()
    })
    .optional(),
  agents: z.record(z.string(), rawAgentProfileSchema)
});

export function resolveConfigPath(cwd = process.cwd()): {
  path: string;
  source: "project" | "user";
} {
  const statePaths = getStatePaths(cwd);

  if (fs.existsSync(statePaths.projectConfigPath)) {
    return { path: statePaths.projectConfigPath, source: "project" };
  }

  return { path: statePaths.userConfigPath, source: "user" };
}

export function parseBrokerConfig(raw: string, sourcePath: string, source: "project" | "user"): BrokerConfig {
  const parsed = YAML.parse(raw) as RawBrokerConfig | null;
  const data = rawConfigSchema.parse(parsed ?? {});

  return {
    path: sourcePath,
    source,
    version: String(data.version ?? "0.1"),
    broker: {
      execution_mode: data.broker?.execution_mode ?? "sync",
      default_output: {
        format: data.broker?.default_output?.format ?? "text"
      }
    },
    agents: data.agents
  };
}

export function loadBrokerConfig(cwd = process.cwd()): BrokerConfig {
  const resolved = resolveConfigPath(cwd);
  if (!fs.existsSync(resolved.path)) {
    throw new Error(
      `Broker config not found. Expected ${resolved.path}. Run "agent-broker init" first.`,
    );
  }

  return parseBrokerConfig(
    fs.readFileSync(resolved.path, "utf8"),
    resolved.path,
    resolved.source,
  );
}
