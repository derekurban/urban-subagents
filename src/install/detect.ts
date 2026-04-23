import fs from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";

import {
  buildSpawnLaunchConfig,
  resolveExecutablePath,
} from "../util/command-launch.js";
import { getPackageRoot } from "../util/paths.js";

export interface CommandInfo {
  command: string;
  exists: boolean;
  resolvedPath: string | null;
  version: string | null;
}

export interface BrokerLaunchConfig {
  command: string;
  args: string[];
}

export function withBrokerHostRuntime(
  launch: BrokerLaunchConfig,
  hostRuntime: "claude" | "codex",
): BrokerLaunchConfig {
  const args = [...launch.args];
  const existingIndex = args.findIndex((arg) => arg === "--host-runtime");
  if (existingIndex >= 0) {
    args.splice(existingIndex, 2);
  }

  args.push("--host-runtime", hostRuntime);
  return {
    command: launch.command,
    args
  };
}

function spawnCapture(command: string, args: string[]) {
  const launch = buildSpawnLaunchConfig(command, args);
  return crossSpawn.sync(launch.command, launch.args, {
    encoding: "utf8",
    windowsHide: true
  });
}

function resolveCommandOverride(command: string): string | null {
  if (command === "claude") {
    return process.env.BROKER_CLAUDE_BIN ?? null;
  }

  if (command === "codex") {
    return process.env.BROKER_CODEX_BIN ?? null;
  }

  return null;
}

function findExecutable(command: string): string | null {
  const override = resolveCommandOverride(command) ?? command;
  return resolveExecutablePath(override);
}

function getVersion(command: string): string | null {
  const result = spawnCapture(command, ["--version"]);
  if (result.error) {
    return null;
  }

  if (result.status !== 0) {
    return null;
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return stdout.trim() || stderr.trim() || null;
}

export function detectCommand(command: string): CommandInfo {
  const resolvedPath = findExecutable(command);
  return {
    command,
    exists: Boolean(resolvedPath),
    resolvedPath,
    version: resolvedPath ? getVersion(resolvedPath) : null
  };
}

export function detectHosts() {
  return {
    claude: detectCommand("claude"),
    codex: detectCommand("codex")
  };
}

function isTsxCliEntrypoint(entrypoint: string): boolean {
  const normalized = entrypoint.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/tsx/") && normalized.endsWith("/cli.mjs");
}

function isTypeScriptEntrypoint(entrypoint: string): boolean {
  return /\.(cts|mts|ts|tsx)$/i.test(entrypoint);
}

interface ResolveBrokerLaunchConfigOptions {
  execPath?: string;
  fileExists?: (target: string) => boolean;
}

export function resolveBrokerLaunchConfigFor(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  options: ResolveBrokerLaunchConfigOptions = {},
): BrokerLaunchConfig {
  const envCommand = env.URBAN_SUBAGENTS_BROKER_COMMAND;
  const envArgs = env.URBAN_SUBAGENTS_BROKER_ARGS;
  if (envCommand) {
    return {
      command: envCommand,
      args: envArgs ? JSON.parse(envArgs) as string[] : ["serve-mcp"]
    };
  }

  const fileExists = options.fileExists ?? fs.existsSync;
  const execPath = options.execPath ?? process.execPath;
  const entrypoint = argv[1];
  const sourceEntrypoint = argv[2];
  const tsxCli = path.join(getPackageRoot(), "node_modules", "tsx", "dist", "cli.mjs");
  if (
    entrypoint &&
    sourceEntrypoint &&
    isTsxCliEntrypoint(entrypoint) &&
    fileExists(entrypoint) &&
    fileExists(sourceEntrypoint)
  ) {
    return {
      command: execPath,
      args: [path.resolve(entrypoint), path.resolve(sourceEntrypoint), "serve-mcp"]
    };
  }

  if (
    entrypoint &&
    isTypeScriptEntrypoint(entrypoint) &&
    fileExists(entrypoint) &&
    fileExists(tsxCli)
  ) {
    return {
      command: execPath,
      args: [path.resolve(tsxCli), path.resolve(entrypoint), "serve-mcp"]
    };
  }

  if (entrypoint && fileExists(entrypoint)) {
    return {
      command: execPath,
      args: [path.resolve(entrypoint), "serve-mcp"]
    };
  }

  return {
    command: "agent-broker",
    args: ["serve-mcp"]
  };
}

export function resolveBrokerLaunchConfig(): BrokerLaunchConfig {
  return resolveBrokerLaunchConfigFor(process.argv, process.env);
}

export function getHookScriptPath(): string {
  return path.join(getPackageRoot(), "plugin", "scripts", "block-native-agent.mjs");
}

export function commandSupportsFlag(command: string, flag: string): boolean {
  const result = spawnCapture(command, ["--help"]);
  if (result.error) {
    return false;
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return `${stdout}${stderr}`.includes(flag);
}
