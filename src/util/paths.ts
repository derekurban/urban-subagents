import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { BrokerEnvironment, HostRuntime } from "../broker/types.js";

export interface StatePaths {
  packageRoot: string;
  homeDir: string;
  backupsDir: string;
  dbPath: string;
  logsDir: string;
  outputsDir: string;
  promptsDir: string;
  userConfigPath: string;
  projectConfigPath: string;
  claudeProjectDir: string;
  claudeProjectInstructionsPath: string;
  claudeProjectSettingsPath: string;
  claudeProjectMcpPath: string;
  codexHomeDir: string;
  codexConfigPath: string;
  codexAgentsPath: string;
}

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const packageRoot = path.resolve(currentDir, "../..");

export function getPackageRoot(): string {
  return packageRoot;
}

export function getUrbanSubagentsHome(): string {
  return process.env.URBAN_SUBAGENTS_HOME
    ? path.resolve(process.env.URBAN_SUBAGENTS_HOME)
    : path.join(os.homedir(), ".urban-subagents");
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");
}

export function getStatePaths(cwd = process.cwd()): StatePaths {
  const homeDir = getUrbanSubagentsHome();
  const codexHomeDir = getCodexHome();
  const claudeProjectDir = path.join(cwd, ".claude");

  return {
    packageRoot,
    homeDir,
    backupsDir: path.join(homeDir, "backups"),
    dbPath: path.join(homeDir, "sessions.db"),
    logsDir: path.join(homeDir, "logs"),
    outputsDir: path.join(homeDir, "outputs"),
    promptsDir: path.join(homeDir, "prompts"),
    userConfigPath: path.join(homeDir, "config.yaml"),
    projectConfigPath: path.join(cwd, ".urban-subagents", "config.yaml"),
    claudeProjectDir,
    claudeProjectInstructionsPath: path.join(claudeProjectDir, "CLAUDE.md"),
    claudeProjectSettingsPath: path.join(claudeProjectDir, "settings.json"),
    claudeProjectMcpPath: path.join(cwd, ".mcp.json"),
    codexHomeDir,
    codexConfigPath: path.join(codexHomeDir, "config.toml"),
    codexAgentsPath: path.join(codexHomeDir, "AGENTS.md")
  };
}

export function getBundledConfigPath(): string {
  return path.join(packageRoot, "config", "agents.example.yaml");
}

export function getBundledPromptPath(name: string): string {
  return path.join(packageRoot, "prompts", `${name}.md`);
}

export function resolvePromptPath(configPath: string, promptFile: string): string {
  if (path.isAbsolute(promptFile)) {
    return promptFile;
  }

  const configDir = path.dirname(configPath);
  const fromConfig = path.resolve(configDir, promptFile);
  if (fromConfig) {
    return fromConfig;
  }

  return path.resolve(packageRoot, promptFile);
}

export function getBrokerEnvironment(): BrokerEnvironment {
  const runtime = process.env.BROKER_HOST_RUNTIME;
  const hostRuntime: HostRuntime =
    runtime === "claude" || runtime === "codex" ? runtime : null;

  return {
    hostSessionId: process.env.BROKER_HOST_SESSION_ID ?? null,
    hostRuntime
  };
}
