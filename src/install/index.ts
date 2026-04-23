import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

import { loadBrokerConfig, parseBrokerConfig } from "../broker/config.js";
import { resolveAgentProfiles } from "../broker/profiles.js";
import { openDatabase } from "../store/db.js";
import { getBundledConfigPath, getBundledPromptPath, getStatePaths } from "../util/paths.js";
import { readTomlFile } from "../util/toml.js";
import { backupFileIfExists, createBackupRoot } from "./backup.js";
import {
  mergeClaudeInstructions,
  mergeClaudeMcpConfig,
  mergeClaudeSettings,
} from "./claude.js";
import { mergeCodexAgentsMarkdown, mergeCodexConfig, renderCodexConfig } from "./codex.js";
import {
  detectHosts,
  getHookScriptPath,
  resolveBrokerLaunchConfig,
  withBrokerHostRuntime,
} from "./detect.js";

export interface InitOptions {
  cwd?: string;
  host?: "all" | "claude" | "codex";
  dryRun?: boolean;
  force?: boolean;
}

interface PlannedWrite {
  target: string;
  content: string;
}

const LEGACY_DEFAULT_PROMPTS: Record<string, string[]> = {
  reviewer: [
    "You are a read-only reviewer.\nInspect the workspace carefully, explain concrete findings, and do not modify files.\n",
  ],
  planner: [],
};

function ensureManagedDirectories(cwd: string): void {
  const statePaths = getStatePaths(cwd);
  for (const target of [
    statePaths.homeDir,
    statePaths.backupsDir,
    statePaths.logsDir,
    statePaths.outputsDir,
    statePaths.promptsDir,
    statePaths.codexHomeDir,
    statePaths.claudeProjectDir,
    path.dirname(statePaths.projectConfigPath)
  ]) {
    fs.mkdirSync(target, { recursive: true });
  }
}

function ensureDefaultConfig(cwd: string): void {
  const statePaths = getStatePaths(cwd);
  if (!fs.existsSync(statePaths.userConfigPath)) {
    fs.copyFileSync(getBundledConfigPath(), statePaths.userConfigPath);
  }

  for (const prompt of ["reviewer", "planner"]) {
    const target = path.join(statePaths.promptsDir, `${prompt}.md`);
    const bundled = fs.readFileSync(getBundledPromptPath(prompt), "utf8");
    if (!fs.existsSync(target)) {
      fs.writeFileSync(target, bundled, "utf8");
      continue;
    }

    const current = fs.readFileSync(target, "utf8");
    if (
      current === bundled ||
      (LEGACY_DEFAULT_PROMPTS[prompt] ?? []).includes(current)
    ) {
      fs.writeFileSync(target, bundled, "utf8");
    }
  }
}

function loadConfigForInit(cwd: string) {
  const statePaths = getStatePaths(cwd);
  ensureDefaultConfig(cwd);

  if (fs.existsSync(statePaths.projectConfigPath)) {
    return loadBrokerConfig(cwd);
  }

  return parseBrokerConfig(
    fs.readFileSync(statePaths.userConfigPath, "utf8"),
    statePaths.userConfigPath,
    "user",
  );
}

function previewWrite(write: PlannedWrite): string {
  return `--- ${write.target} ---\n${write.content}`;
}

async function confirmWrites(writes: PlannedWrite[]): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await rl.question(
      `About to write ${writes.length} file(s). Continue? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

export async function runInit(options: InitOptions = {}): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const host = options.host ?? "all";
  ensureManagedDirectories(cwd);

  const detected = detectHosts();
  if ((host === "all" || host === "claude") && !detected.claude.exists) {
    throw new Error("Claude CLI was not found on PATH.");
  }
  if ((host === "all" || host === "codex") && !detected.codex.exists) {
    throw new Error("Codex CLI was not found on PATH.");
  }

  const config = loadConfigForInit(cwd);
  const profiles = resolveAgentProfiles(config);
  const launch = resolveBrokerLaunchConfig();
  const claudeLaunch = withBrokerHostRuntime(launch, "claude");
  const codexLaunch = withBrokerHostRuntime(launch, "codex");
  const statePaths = getStatePaths(cwd);
  const hookCommand = `"${process.execPath}" "${getHookScriptPath()}"`;

  const writes: PlannedWrite[] = [];

  if (host === "all" || host === "claude") {
    const existingSettings = fs.existsSync(statePaths.claudeProjectSettingsPath)
      ? JSON.parse(fs.readFileSync(statePaths.claudeProjectSettingsPath, "utf8")) as Record<string, unknown>
      : {};
    const nextSettings = mergeClaudeSettings(existingSettings, hookCommand);
    const existingInstructions = fs.existsSync(statePaths.claudeProjectInstructionsPath)
      ? fs.readFileSync(statePaths.claudeProjectInstructionsPath, "utf8")
      : "";
    const nextInstructions = mergeClaudeInstructions(existingInstructions);

    const existingMcp = fs.existsSync(statePaths.claudeProjectMcpPath)
      ? JSON.parse(fs.readFileSync(statePaths.claudeProjectMcpPath, "utf8")) as Record<string, unknown>
      : {};
    const nextMcp = mergeClaudeMcpConfig(existingMcp as never, claudeLaunch);

    writes.push({
      target: statePaths.claudeProjectSettingsPath,
      content: JSON.stringify(nextSettings, null, 2) + "\n"
    });
    writes.push({
      target: statePaths.claudeProjectInstructionsPath,
      content: nextInstructions
    });
    writes.push({
      target: statePaths.claudeProjectMcpPath,
      content: JSON.stringify(nextMcp, null, 2) + "\n"
    });
  }

  if (host === "all" || host === "codex") {
    const existingCodex = readTomlFile<Record<string, unknown>>(statePaths.codexConfigPath);
    const nextCodex = mergeCodexConfig(existingCodex, profiles, codexLaunch);
    const existingAgents = fs.existsSync(statePaths.codexAgentsPath)
      ? fs.readFileSync(statePaths.codexAgentsPath, "utf8")
      : "";
    const nextAgents = mergeCodexAgentsMarkdown(existingAgents);

    writes.push({
      target: statePaths.codexConfigPath,
      content: renderCodexConfig(nextCodex)
    });
    writes.push({
      target: statePaths.codexAgentsPath,
      content: nextAgents
    });
  }

  if (options.dryRun) {
    return writes.map(previewWrite);
  }

  if (!options.force) {
    const confirmed = await confirmWrites(writes);
    if (!confirmed) {
      throw new Error("Init aborted.");
    }
  }

  const backupRoot = createBackupRoot(statePaths.backupsDir);
  for (const write of writes) {
    backupFileIfExists(write.target, backupRoot);
    fs.mkdirSync(path.dirname(write.target), { recursive: true });
    fs.writeFileSync(write.target, write.content, "utf8");
  }

  const db = openDatabase(cwd);
  db.close();

  return writes.map((write) => write.target);
}
