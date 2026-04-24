import { randomUUID } from "node:crypto";

import type { AgentProfile, BrokerEnvironment, DelegateRequest, DelegateResult } from "../broker/types.js";
import { SessionStore } from "../store/sessions.js";
import { createLogger } from "../util/logging.js";
import { getStatePaths } from "../util/paths.js";
import {
  createEmptyChildMcpConfig,
  fallbackEnv,
  readPromptFile,
  runCommand,
} from "./shared.js";

export type ClaudeExecutionMode = "strict" | "oauth-acceptance";

export interface ClaudeAdapterOptions {
  profile: AgentProfile;
  request: DelegateRequest;
  cwd: string;
  command?: string;
  brokerEnvironment: BrokerEnvironment;
  sessionStore: SessionStore;
}

export function getClaudeExecutionMode(
  env: NodeJS.ProcessEnv = process.env,
): ClaudeExecutionMode {
  return env.BROKER_CLAUDE_MODE === "strict" ? "strict" : "oauth-acceptance";
}

export function buildClaudeModeArgs(mode: ClaudeExecutionMode): string[] {
  if (mode === "oauth-acceptance") {
    return [
      "--disable-slash-commands",
      "--setting-sources",
      "local"
    ];
  }

  return ["--bare"];
}

export function buildClaudeEnv(mode: ClaudeExecutionMode): NodeJS.ProcessEnv {
  const env = fallbackEnv({
    URBAN_SUBAGENTS_CHILD: "1"
  });
  delete env.BROKER_HOST_SESSION_ID;
  delete env.BROKER_HOST_RUNTIME;
  delete env.URBAN_SUBAGENTS_BROKER_COMMAND;
  delete env.URBAN_SUBAGENTS_BROKER_ARGS;

  if (mode === "oauth-acceptance") {
    delete env.CLAUDE_ENV_FILE;
    delete env.CLAUDE_PLUGIN_ROOT;
  }

  return env;
}

export async function runClaudeDelegate(
  options: ClaudeAdapterOptions,
): Promise<DelegateResult> {
  const logger = createLogger("claude-adapter");
  const sessionId = options.request.session_id ?? randomUUID();
  const isResume = Boolean(options.request.session_id);
  const command = options.command ?? process.env.BROKER_CLAUDE_BIN ?? "claude";
  const mode = getClaudeExecutionMode();
  const promptAppend = readPromptFile(options.profile.promptFilePath);
  const childMcpConfig = createEmptyChildMcpConfig(
    getStatePaths(options.cwd).outputsDir,
    sessionId,
  );

  const args = [
    "-p",
    options.request.prompt,
    "--output-format",
    "json",
    "--tools",
    options.profile.claude.tools.join(","),
    "--disallowedTools",
    "Agent,TaskCreate,TaskGet,TaskUpdate,TaskDelete",
    "--strict-mcp-config",
    "--mcp-config",
    childMcpConfig,
    ...buildClaudeModeArgs(mode),
    "--append-system-prompt",
    promptAppend,
    "--model",
    options.profile.model,
    "--effort",
    options.profile.claude.effort,
    "--permission-mode",
    options.profile.claude.permissionMode,
  ];

  if (isResume) {
    args.push("--resume", sessionId);
  } else {
    args.push("--session-id", sessionId);
  }

  let spawnedPid: number | null = null;

  if (!isResume) {
    options.sessionStore.createRunningSession({
      session_id: sessionId,
      provider_handle: sessionId,
      runtime: "claude_code",
      parent_session_id: options.brokerEnvironment.hostSessionId,
      parent_runtime: options.brokerEnvironment.hostRuntime,
      agent: options.profile.name,
      cwd: options.cwd,
      pid: null
    });
  }

  options.sessionStore.addEvent({
    session_id: sessionId,
    kind: isResume ? "resume" : "start",
    payload: {
      runtime: "claude_code",
      agent: options.profile.name
    }
  });

  const result = await runCommand({
    command,
    args,
    cwd: options.cwd,
    env: buildClaudeEnv(mode),
    onSpawn(pid) {
      spawnedPid = pid;
      options.sessionStore.createRunningSession({
        session_id: sessionId,
        provider_handle: sessionId,
        runtime: "claude_code",
        parent_session_id: options.brokerEnvironment.hostSessionId,
        parent_runtime: options.brokerEnvironment.hostRuntime,
        agent: options.profile.name,
        cwd: options.cwd,
        pid
      });
    },
    onStderrLine(line) {
      logger.warn("Claude stderr", { line, sessionId });
    }
  });

  const interruptedResult = (partialResult?: string): DelegateResult | null => {
    const session = options.sessionStore.getSession(sessionId);
    if (session?.status !== "interrupted") {
      return null;
    }

    options.sessionStore.markSession(sessionId, "interrupted", {
      durationMs: result.durationMs,
      result: session.result ?? partialResult ?? null,
      error: session.error
    });

    return {
      session_id: sessionId,
      provider_handle: session.provider_handle,
      status: "interrupted",
      result: session.result ?? partialResult ?? "",
      duration_ms: result.durationMs,
      runtime: "claude_code"
    };
  };

  const jsonLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();

  if (!jsonLine) {
    const interrupted = interruptedResult();
    if (interrupted) {
      return interrupted;
    }

    const message = result.stderr || "Claude produced no JSON output.";
    options.sessionStore.markSession(sessionId, "failed", {
      durationMs: result.durationMs,
      error: message
    });
    throw new Error(message);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonLine) as Record<string, unknown>;
  } catch (error) {
    const interrupted = interruptedResult();
    if (interrupted) {
      return interrupted;
    }

    options.sessionStore.markSession(sessionId, "failed", {
      durationMs: result.durationMs,
      error: `Failed to parse Claude JSON output: ${(error as Error).message}`
    });
    throw error;
  }

  const providerHandle = String(parsed.session_id ?? sessionId);
  const textResult =
    typeof parsed.result === "string"
      ? parsed.result
      : JSON.stringify(parsed.structured_output ?? parsed, null, 2);

  if (result.exitCode !== 0) {
    const interrupted = interruptedResult(textResult);
    if (interrupted) {
      return interrupted;
    }

    const message = result.stderr || `Claude exited with code ${result.exitCode}.`;
    options.sessionStore.markSession(sessionId, "failed", {
      durationMs: result.durationMs,
      error: message,
      result: textResult
    });
    options.sessionStore.addEvent({
      session_id: sessionId,
      kind: "error",
      payload: { message, exitCode: result.exitCode }
    });
    throw new Error(message);
  }

  options.sessionStore.markSession(sessionId, "completed", {
    durationMs: result.durationMs,
    result: textResult
  });
  options.sessionStore.addEvent({
    session_id: sessionId,
    kind: "end",
    payload: { exitCode: result.exitCode, pid: spawnedPid }
  });

  return {
    session_id: sessionId,
    provider_handle: providerHandle,
    status: "completed",
    result: textResult,
    duration_ms: result.durationMs,
    runtime: "claude_code"
  };
}
