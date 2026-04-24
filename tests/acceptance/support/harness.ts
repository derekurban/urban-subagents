import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import crossSpawn from "cross-spawn";

import {
  buildSpawnLaunchConfig,
  resolveExecutablePath,
} from "../../../src/util/command-launch.js";

export type Provider = "claude" | "codex";

export interface AcceptanceContext {
  rootDir: string;
  workspaceDir: string;
  urbanHomeDir: string;
  claudeHomeDir: string;
  claudeConfigPath: string;
  codexHomeDir: string;
  hookLogPath: string;
  env: NodeJS.ProcessEnv;
  enabledProviders: Provider[];
  cleanup(): void;
}

export interface CliRunResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

export interface SpawnedCliRun {
  child: ChildProcessWithoutNullStreams;
  completion: Promise<CliRunResult>;
}

let cachedEnabledProviders: Provider[] | null = null;

function repoRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../../..");
}

export function getBrokerCliArgs(args: string[] = []): string[] {
  return [
    path.join(repoRoot(), "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repoRoot(), "src", "cli", "index.ts"),
    ...args
  ];
}

export function isAcceptanceEnabled(): boolean {
  return process.env.RUN_REAL_ACCEPTANCE === "1";
}

export function resolveRealProviderCommand(provider: Provider): string | null {
  const explicit =
    provider === "claude"
      ? process.env.URBAN_SUBAGENTS_REAL_CLAUDE_BIN
      : process.env.URBAN_SUBAGENTS_REAL_CODEX_BIN;

  if (explicit) {
    return explicit;
  }

  return resolveExecutablePath(provider);
}

function canRunClaude(command: string): boolean {
  const launch = buildSpawnLaunchConfig(command, [
    "-p",
    "Reply with OK only.",
    "--output-format",
    "json",
    "--session-id",
    randomUUID(),
    "--tools",
    "Read",
    "--disable-slash-commands",
    "--setting-sources",
    "local",
    "--model",
    "opus",
    "--effort",
    "low",
    "--permission-mode",
    "bypassPermissions"
  ]);
  const result = crossSpawn.sync(launch.command, launch.args, {
    encoding: "utf8",
    windowsHide: true
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return result.status === 0 && !/Not logged in/i.test(output);
}

function canRunCodex(command: string): boolean {
  const launch = buildSpawnLaunchConfig(command, [
    "exec",
    "--ignore-user-config",
    "--json",
    "--skip-git-repo-check",
    "-"
  ]);
  const result = crossSpawn.sync(launch.command, launch.args, {
    input: "Reply with OK only.",
    encoding: "utf8",
    windowsHide: true
  });

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return result.status === 0 && !/not logged in|please run \/login/i.test(output);
}

export function getEnabledProviders(): Provider[] {
  if (cachedEnabledProviders) {
    return cachedEnabledProviders;
  }

  if (!isAcceptanceEnabled()) {
    return [];
  }

  const explicitClaude = process.env.RUN_REAL_CLAUDE === "1";
  const explicitCodex = process.env.RUN_REAL_CODEX === "1";
  const hasExplicit = explicitClaude || explicitCodex;

  const providers: Provider[] = [];
  if (hasExplicit) {
    const claude = resolveRealProviderCommand("claude");
    if (explicitClaude && claude && canRunClaude(claude)) {
      providers.push("claude");
    }
    const codex = resolveRealProviderCommand("codex");
    if (explicitCodex && codex && canRunCodex(codex)) {
      providers.push("codex");
    }
    cachedEnabledProviders = providers;
    return cachedEnabledProviders;
  }

  for (const provider of ["claude", "codex"] satisfies Provider[]) {
    const command = resolveRealProviderCommand(provider);
    if (
      command &&
      (provider === "claude" ? canRunClaude(command) : canRunCodex(command))
    ) {
      providers.push(provider);
    }
  }

  cachedEnabledProviders = providers;
  return cachedEnabledProviders;
}

export function isProviderEnabled(provider: Provider): boolean {
  return getEnabledProviders().includes(provider);
}

export function acceptanceHostForProviders(
  providers: Provider[],
): "all" | "claude" | "codex" {
  if (providers.includes("claude") && providers.includes("codex")) {
    return "all";
  }

  return providers[0] ?? "all";
}

export function getDefaultAgentForProvider(provider: Provider): string {
  return provider === "claude" ? "planner" : "reviewer";
}

function seedCodexAuth(codexHomeDir: string): void {
  const sourceHome = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(os.homedir(), ".codex");

  for (const name of [
    "auth.json",
    "cap_sid",
    "config.json",
    "installation_id",
    "version.json"
  ]) {
    const source = path.join(sourceHome, name);
    const target = path.join(codexHomeDir, name);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    }
  }
}

export function createAcceptanceContext(name: string): AcceptanceContext {
  const enabledProviders = getEnabledProviders();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `urban-acceptance-${name}-`));
  const workspaceDir = path.join(rootDir, "workspace");
  const urbanHomeDir = path.join(rootDir, "urban-home");
  const claudeHomeDir = path.join(rootDir, "claude-home");
  const claudeConfigPath = path.join(rootDir, ".claude.json");
  const codexHomeDir = path.join(rootDir, "codex-home");
  const hookLogPath = path.join(rootDir, "hook-log.jsonl");
  const brokerArgs = getBrokerCliArgs(["serve-mcp"]);

  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(urbanHomeDir, { recursive: true });
  fs.mkdirSync(claudeHomeDir, { recursive: true });
  fs.mkdirSync(codexHomeDir, { recursive: true });
  seedCodexAuth(codexHomeDir);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    URBAN_SUBAGENTS_HOME: urbanHomeDir,
    URBAN_SUBAGENTS_CLAUDE_HOME: claudeHomeDir,
    URBAN_SUBAGENTS_CLAUDE_CONFIG_PATH: claudeConfigPath,
    CODEX_HOME: codexHomeDir,
    URBAN_SUBAGENTS_BROKER_COMMAND: process.execPath,
    URBAN_SUBAGENTS_BROKER_ARGS: JSON.stringify(brokerArgs),
    URBAN_SUBAGENTS_TEST_HOOK_LOG: hookLogPath,
    BROKER_CLAUDE_MODE: "oauth-acceptance"
  };

  const realClaude = resolveRealProviderCommand("claude");
  const realCodex = resolveRealProviderCommand("codex");
  if (realClaude) {
    env.BROKER_CLAUDE_BIN = realClaude;
  }
  if (realCodex) {
    env.BROKER_CODEX_BIN = realCodex;
  }

  return {
    rootDir,
    workspaceDir,
    urbanHomeDir,
    claudeHomeDir,
    claudeConfigPath,
    codexHomeDir,
    hookLogPath,
    env,
    enabledProviders,
    cleanup() {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  };
}

export function createProxyEnv(
  context: AcceptanceContext,
  provider: Provider,
  delayMs: number,
): NodeJS.ProcessEnv {
  const realCommand = resolveRealProviderCommand(provider);
  if (!realCommand) {
    throw new Error(`Real ${provider} binary was not found.`);
  }

  const proxyDir = path.join(repoRoot(), "tests", "acceptance", "support", "provider-proxy");
  const proxyWrapper = path.join(
    proxyDir,
    process.platform === "win32" ? `${provider}.cmd` : provider,
  );

  return {
    ...context.env,
    ...(provider === "claude"
      ? { BROKER_CLAUDE_BIN: proxyWrapper }
      : { BROKER_CODEX_BIN: proxyWrapper }),
    URBAN_SUBAGENTS_PROVIDER_REAL_BIN: realCommand,
    URBAN_SUBAGENTS_PROVIDER_DELAY_MS: String(delayMs)
  };
}

export async function runBrokerCli(
  context: AcceptanceContext,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    check?: boolean;
  } = {},
): Promise<CliRunResult> {
  const result = await spawnBrokerCli(context, args, options).completion;
  if ((options.check ?? true) && result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `CLI exited with ${result.exitCode}.`);
  }

  return result;
}

export function spawnBrokerCli(
  context: AcceptanceContext,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
  } = {},
): SpawnedCliRun {
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot(), "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(repoRoot(), "src", "cli", "index.ts"),
      ...args
    ],
    {
      cwd: options.cwd ?? context.workspaceDir,
      env: options.env ?? context.env,
      stdio: "pipe",
      windowsHide: true
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  if (options.stdin !== undefined) {
    child.stdin.write(options.stdin);
  }
  child.stdin.end();

  return {
    child,
    completion: new Promise<CliRunResult>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve({
          exitCode: code ?? 0,
          signal,
          stdout,
          stderr
        });
      });
    })
  };
}

export async function runBrokerCliJson<T>(
  context: AcceptanceContext,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    check?: boolean;
  } = {},
): Promise<T> {
  const result = await runBrokerCli(context, args, options);
  try {
    return JSON.parse(result.stdout) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse CLI JSON output: ${(error as Error).message}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
}

function openSessionDb(context: AcceptanceContext): Database.Database | null {
  const dbPath = path.join(context.urbanHomeDir, "sessions.db");
  if (!fs.existsSync(dbPath)) {
    return null;
  }

  return new Database(dbPath, { readonly: true });
}

export function readSession(
  context: AcceptanceContext,
  sessionId: string,
): Record<string, unknown> | null {
  const db = openSessionDb(context);
  if (!db) {
    return null;
  }

  try {
    return (
      (db
        .prepare("SELECT * FROM sessions WHERE session_id = ?")
        .get(sessionId) as Record<string, unknown> | undefined) ?? null
    );
  } finally {
    db.close();
  }
}

export function readSessionEvents(
  context: AcceptanceContext,
  sessionId: string,
): Array<Record<string, unknown>> {
  const db = openSessionDb(context);
  if (!db) {
    return [];
  }

  try {
    const rows = db
      .prepare("SELECT * FROM session_events WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      payload:
        typeof row.payload === "string" && row.payload
          ? JSON.parse(row.payload)
          : row.payload
    }));
  } finally {
    db.close();
  }
}

export async function waitForRunningSession(
  context: AcceptanceContext,
  agent: string,
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = openSessionDb(context);
    if (db) {
      try {
        const row = db
          .prepare(
            "SELECT * FROM sessions WHERE agent = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1",
          )
          .get(agent) as Record<string, unknown> | undefined;
        if (row && row.pid !== null) {
          return row;
        }
      } finally {
        db.close();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for running session for agent "${agent}".`);
}

export async function waitForRunningSessionWithPid(
  context: AcceptanceContext,
  agent: string,
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = openSessionDb(context);
    if (db) {
      try {
        const row = db
          .prepare(
            "SELECT * FROM sessions WHERE agent = ? AND status = 'running' AND pid IS NOT NULL ORDER BY created_at DESC LIMIT 1",
          )
          .get(agent) as Record<string, unknown> | undefined;
        if (row) {
          return row;
        }
      } finally {
        db.close();
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for running session for agent "${agent}".`);
}

export async function waitForSessionStatus(
  context: AcceptanceContext,
  sessionId: string,
  statuses: string[],
  timeoutMs = 30000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = readSession(context, sessionId);
    if (session && statuses.includes(String(session.status))) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `Timed out waiting for session ${sessionId} to reach one of: ${statuses.join(", ")}`,
  );
}

export function readHookLog(context: AcceptanceContext): Array<Record<string, unknown>> {
  if (!fs.existsSync(context.hookLogPath)) {
    return [];
  }

  return fs
    .readFileSync(context.hookLogPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function writeWorkspaceFile(
  context: AcceptanceContext,
  relativePath: string,
  contents: string,
): string {
  const target = path.join(context.workspaceDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
  return target;
}

export function readWorkspaceFile(
  context: AcceptanceContext,
  relativePath: string,
): string {
  return fs.readFileSync(path.join(context.workspaceDir, relativePath), "utf8");
}
