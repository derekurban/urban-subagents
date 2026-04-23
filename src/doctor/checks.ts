import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { loadBrokerConfig } from "../broker/config.js";
import { resolveAgentProfiles } from "../broker/profiles.js";
import {
  buildClaudeModeArgs,
  buildClaudeEnv,
  getClaudeExecutionMode,
} from "../adapters/claude.js";
import { createEmptyChildMcpConfig } from "../adapters/shared.js";
import { runCommand } from "../adapters/shared.js";
import {
  hasManagedClaudeDenyEntries,
  hasManagedClaudeMcpServer,
} from "../install/claude.js";
import { runInit } from "../install/index.js";
import {
  commandSupportsFlag,
  detectHosts,
  resolveBrokerLaunchConfig,
} from "../install/detect.js";
import { openDatabase } from "../store/db.js";
import { SessionStore } from "../store/sessions.js";
import { getStatePaths } from "../util/paths.js";
import { readTomlFile } from "../util/toml.js";
import type { DoctorCheckResult } from "./report.js";

export interface DoctorOptions {
  cwd?: string;
  verbose?: boolean;
  fix?: boolean;
  host?: "all" | "claude" | "codex";
}

function pass(id: string, title: string, detail: string): DoctorCheckResult {
  return { id, title, status: "pass", detail };
}

function warn(
  id: string,
  title: string,
  detail: string,
  fixSuggestion?: string,
): DoctorCheckResult {
  return {
    id,
    title,
    status: "warn",
    detail,
    ...(fixSuggestion ? { fixSuggestion } : {})
  };
}

function fail(
  id: string,
  title: string,
  detail: string,
  fixSuggestion?: string,
): DoctorCheckResult {
  return {
    id,
    title,
    status: "fail",
    detail,
    ...(fixSuggestion ? { fixSuggestion } : {})
  };
}

async function runMcpSmokeTest(cwd: string): Promise<DoctorCheckResult> {
  try {
    const launch = resolveBrokerLaunchConfig();
    const transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      cwd,
      env: {
        ...process.env,
        URBAN_SUBAGENTS_HOME: process.env.URBAN_SUBAGENTS_HOME ?? "",
        CODEX_HOME: process.env.CODEX_HOME ?? ""
      } as Record<string, string>,
      stderr: "pipe"
    });
    const client = new Client({
      name: "urban-subagents-doctor",
      version: "0.1.0"
    });
    await client.connect(transport);
    const tools = await client.listTools();
    await transport.close();

    if (tools.tools.length < 4) {
      return fail(
        "mcp",
        "MCP Smoke Test",
        `Expected at least 4 tools, got ${tools.tools.length}.`,
      );
    }

    return pass(
      "mcp",
      "MCP Smoke Test",
      `Broker MCP responded with ${tools.tools.length} tools.`,
    );
  } catch (error) {
    return fail(
      "mcp",
      "MCP Smoke Test",
      (error as Error).message,
      "Run `agent-broker init --force` and ensure the config file exists.",
    );
  }
}

async function runProviderSmokeTests(
  cwd: string,
  host: "all" | "claude" | "codex",
  statePaths = getStatePaths(cwd),
): Promise<DoctorCheckResult[]> {
  const results: DoctorCheckResult[] = [];
  const childMcpConfig = createEmptyChildMcpConfig(
    statePaths.outputsDir,
    "doctor-empty",
  );

  if (host === "all" || host === "claude") {
    const claude = process.env.BROKER_CLAUDE_BIN ?? "claude";
    const claudeMode = getClaudeExecutionMode();
    try {
      const claudeRun = await runCommand({
        command: claude,
        args: [
          "-p",
          "Reply with OK only.",
          "--output-format",
          "json",
          "--session-id",
          randomUUID(),
          "--tools",
          "Read",
          "--strict-mcp-config",
          "--mcp-config",
          childMcpConfig,
          ...buildClaudeModeArgs(claudeMode),
          "--permission-mode",
          "bypassPermissions"
        ],
        cwd,
        env: buildClaudeEnv(claudeMode)
      });

      const parsed = JSON.parse(
        claudeRun.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .pop() ?? "{}",
      ) as Record<string, unknown>;

      if (typeof parsed.session_id === "string") {
        results.push(
          pass(
            "provider-claude",
            "Claude Smoke Test",
            `Claude returned JSON output and session_id ${parsed.session_id}.`,
          ),
        );
      } else {
        results.push(
          warn(
            "provider-claude",
            "Claude Smoke Test",
            "Claude ran but no session_id was detected in the JSON output.",
          ),
        );
      }
    } catch (error) {
      results.push(
        warn(
          "provider-claude",
          "Claude Smoke Test",
          `Claude smoke test skipped or failed: ${(error as Error).message}`,
        ),
      );
    }
  }

  if (host === "all" || host === "codex") {
    const codexCapture = `${statePaths.outputsDir}\\doctor-codex-output.txt`;
    fs.writeFileSync(codexCapture, "", "utf8");

    const codex = process.env.BROKER_CODEX_BIN ?? "codex";
    try {
      const codexRun = await runCommand({
        command: codex,
        args: [
          "exec",
          "--json",
          "-o",
          codexCapture,
          "-c",
          'approval_policy="never"',
          "-c",
          'sandbox_mode="read-only"',
        "-c",
        'model="gpt-5.4"',
        "-c",
        "features.multi_agent=false",
        "-c",
        "agents.max_depth=1",
        "-c",
        "agents.max_threads=1",
        "--skip-git-repo-check",
        "-"
      ],
        cwd,
        stdin: "Reply with OK only."
      });

      const providerHandle = codexRun.stdout.match(
        /"(?:session_id|thread_id)"\s*:\s*"([^"]+)"/,
      )?.[1];
      if (providerHandle) {
        results.push(
          pass(
            "provider-codex",
            "Codex Smoke Test",
            `Codex returned JSONL output and provider handle ${providerHandle}.`,
          ),
        );
      } else {
        results.push(
          warn(
            "provider-codex",
            "Codex Smoke Test",
            "Codex ran but no provider handle was detected in the JSONL output.",
          ),
        );
      }
    } catch (error) {
      results.push(
        warn(
          "provider-codex",
          "Codex Smoke Test",
          `Codex smoke test skipped or failed: ${(error as Error).message}`,
        ),
      );
    }
  }

  return results;
}

async function collectDoctorChecks(options: DoctorOptions): Promise<DoctorCheckResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const host = options.host ?? "all";
  const statePaths = getStatePaths(cwd);
  const results: DoctorCheckResult[] = [];
  const detected = detectHosts();

  const claudeReady =
    detected.claude.exists &&
    Boolean(detected.claude.resolvedPath) &&
    commandSupportsFlag(detected.claude.resolvedPath!, "--session-id");
  const codexReady =
    detected.codex.exists &&
    Boolean(detected.codex.resolvedPath) &&
    commandSupportsFlag(detected.codex.resolvedPath!, "--profile");

  const binariesOk =
    host === "all"
      ? claudeReady && codexReady
      : host === "claude"
        ? claudeReady
        : codexReady;

  if (binariesOk) {
    results.push(
      pass(
        "binaries",
        "Provider Binaries",
        host === "all"
          ? `Claude: ${detected.claude.version ?? detected.claude.resolvedPath}; Codex: ${detected.codex.version ?? detected.codex.resolvedPath}`
          : host === "claude"
            ? `Claude: ${detected.claude.version ?? detected.claude.resolvedPath}`
            : `Codex: ${detected.codex.version ?? detected.codex.resolvedPath}`,
      ),
    );
  } else {
    results.push(
      fail(
        "binaries",
        "Provider Binaries",
        "Required provider CLIs are missing or do not expose the expected flags.",
        "Install or upgrade Claude Code and Codex so the broker can call them headlessly.",
      ),
    );
  }

  if (host === "all" || host === "claude") {
    const claudeSettingsExists = fs.existsSync(statePaths.claudeProjectSettingsPath);
    if (claudeSettingsExists) {
      const settings = JSON.parse(
        fs.readFileSync(statePaths.claudeProjectSettingsPath, "utf8"),
      ) as Record<string, unknown>;
      const hooks =
        ((settings.hooks as Record<string, unknown> | undefined)?.PreToolUse as Array<Record<string, unknown>> | undefined) ??
        [];
      const hookPresent = hooks.some((entry) => entry.matcher === "Agent");

      if (hasManagedClaudeDenyEntries(settings) && hookPresent) {
        results.push(
          pass(
            "claude",
            "Claude Settings",
            "Project Claude settings disable native Agent and Task tools and register the redirect hook.",
          ),
        );
      } else if (hasManagedClaudeDenyEntries(settings)) {
        results.push(
          pass(
            "claude",
            "Claude Settings",
            "Project Claude settings disable native Agent and Task tools. The redirect hook is optional in the current host strategy.",
          ),
        );
      } else {
        results.push(
          fail(
            "claude",
            "Claude Settings",
            "Claude settings are missing one or more managed native delegation deny entries.",
            "Run `agent-broker init --force --host claude`.",
          ),
        );
      }
    } else {
      results.push(
        fail(
          "claude",
          "Claude Settings",
          "Expected `.claude/settings.json` in the project root.",
          "Run `agent-broker init --force --host claude`.",
        ),
      );
    }
  }

  if (host === "all" || host === "claude") {
    if (fs.existsSync(statePaths.claudeProjectMcpPath)) {
      try {
        const config = JSON.parse(
          fs.readFileSync(statePaths.claudeProjectMcpPath, "utf8"),
        ) as Record<string, unknown>;

        if (hasManagedClaudeMcpServer(config)) {
          results.push(
            pass(
              "claude-mcp",
              "Claude MCP Config",
              "Project .mcp.json registers the broker under mcpServers.urban-subagents.",
            ),
          );
        } else if (
          config["urban-subagents"] &&
          !("mcpServers" in config)
        ) {
          results.push(
            fail(
              "claude-mcp",
              "Claude MCP Config",
              "Project .mcp.json uses a legacy top-level urban-subagents entry instead of mcpServers.urban-subagents.",
              "Run `agent-broker init --force --host claude`.",
            ),
          );
        } else {
          results.push(
            fail(
              "claude-mcp",
              "Claude MCP Config",
              "Project .mcp.json is missing mcpServers.urban-subagents with command and args.",
              "Run `agent-broker init --force --host claude`.",
            ),
          );
        }
      } catch (error) {
        results.push(
          fail(
            "claude-mcp",
            "Claude MCP Config",
            `Unable to parse .mcp.json: ${(error as Error).message}`,
            "Run `agent-broker init --force --host claude`.",
          ),
        );
      }
    } else {
      results.push(
        fail(
          "claude-mcp",
          "Claude MCP Config",
          "Expected `.mcp.json` in the project root.",
          "Run `agent-broker init --force --host claude`.",
        ),
      );
    }
  }

  if (host === "all" || host === "claude") {
    const instructions = fs.existsSync(statePaths.claudeProjectInstructionsPath)
      ? fs.readFileSync(statePaths.claudeProjectInstructionsPath, "utf8")
      : "";
    if (
      instructions.includes("<!-- urban-subagents -->") &&
      instructions.includes("<!-- /urban-subagents -->") &&
      instructions.includes("mcp__urban-subagents__delegate")
    ) {
      results.push(
        pass(
          "claude-md",
          "CLAUDE.md",
          "Managed CLAUDE.md broker instructions are present.",
        ),
      );
    } else {
      results.push(
        fail(
          "claude-md",
          "CLAUDE.md",
          "Managed broker instruction block is missing from .claude/CLAUDE.md.",
          "Run `agent-broker init --force --host claude`.",
        ),
      );
    }
  }

  if (host === "all" || host === "codex") {
    try {
      const config = loadBrokerConfig(cwd);
      const agentProfiles = resolveAgentProfiles(config);
      const codexConfig = readTomlFile<Record<string, unknown>>(statePaths.codexConfigPath);
      const features = (codexConfig.features ?? {}) as Record<string, unknown>;
      const agents = (codexConfig.agents ?? {}) as Record<string, unknown>;
      const mcpServers = (codexConfig.mcp_servers ?? {}) as Record<string, unknown>;
      const profiles = (codexConfig.profiles ?? {}) as Record<string, unknown>;

      const providerProfiles =
        host === "codex"
          ? agentProfiles.filter((profile) => profile.runtime === "codex_exec")
          : agentProfiles;
      const profileCoverage = providerProfiles.every((profile) => profile.name in profiles);
      const brokerRegistered = "urban-subagents" in mcpServers;

      if (
        features.multi_agent === false &&
        agents.max_depth === 1 &&
        agents.max_threads === 1 &&
        brokerRegistered &&
        profileCoverage
      ) {
        results.push(
          pass(
            "codex",
            "Codex Config",
            "Codex config disables native subagents, registers the broker MCP, and contains agent profiles.",
          ),
        );
      } else {
        results.push(
          fail(
            "codex",
            "Codex Config",
            "Codex config is missing one or more managed broker settings.",
            "Run `agent-broker init --force --host codex`.",
          ),
        );
      }
    } catch (error) {
      results.push(
        fail(
          "codex",
          "Codex Config",
          `Unable to validate Codex config: ${(error as Error).message}`,
          "Run `agent-broker init --force --host codex`.",
        ),
      );
    }
  }

  if (host === "all" || host === "codex") {
    const agentsMd = fs.existsSync(statePaths.codexAgentsPath)
      ? fs.readFileSync(statePaths.codexAgentsPath, "utf8")
      : "";
    if (
      agentsMd.includes("<!-- urban-subagents -->") &&
      agentsMd.includes("<!-- /urban-subagents -->")
    ) {
      results.push(
        pass("agents-md", "AGENTS.md", "Managed AGENTS.md broker instructions are present."),
      );
    } else {
      results.push(
        fail(
          "agents-md",
          "AGENTS.md",
          "Managed broker instruction block is missing from AGENTS.md.",
          "Run `agent-broker init --force --host codex`.",
        ),
      );
    }
  }

  results.push(await runMcpSmokeTest(cwd));

  try {
    const db = openDatabase(cwd);
    const store = new SessionStore(db);
    const journalMode = db.pragma("journal_mode", { simple: true }) as string;
    const userVersion = db.pragma("user_version", { simple: true }) as number;
    const orphanCount = store.orphanCleanup();
    db.close();

    if (journalMode.toLowerCase() === "wal" && userVersion >= 1) {
      results.push(
        pass(
          "state",
          "State Directory",
          `sessions.db is writable, WAL mode is active, schema version is ${userVersion}.`,
        ),
      );
    } else {
      results.push(
        fail(
          "state",
          "State Directory",
          `Unexpected DB state: journal_mode=${journalMode}, schema=${userVersion}.`,
        ),
      );
    }

    results.push(
      pass(
        "orphans",
        "Orphan Sweep",
        orphanCount > 0
          ? `Marked ${orphanCount} orphaned running session(s) as interrupted.`
          : "No orphaned running sessions were found.",
      ),
    );
  } catch (error) {
    results.push(
      fail(
        "state",
        "State Directory",
        `Unable to validate database state: ${(error as Error).message}`,
      ),
    );
  }

  if (options.verbose) {
    results.push(...(await runProviderSmokeTests(cwd, host, statePaths)));
  }

  return results;
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorCheckResult[]> {
  const initial = await collectDoctorChecks(options);

  if (
    options.fix &&
    initial.some(
      (result) =>
        result.status === "fail" &&
        ["claude", "claude-mcp", "claude-md", "codex", "agents-md"].includes(result.id),
    )
  ) {
    await runInit({
      host: options.host ?? "all",
      ...(options.cwd ? { cwd: options.cwd } : {}),
      force: true
    });
    return await collectDoctorChecks({
      ...options,
      fix: false
    });
  }

  return initial;
}
