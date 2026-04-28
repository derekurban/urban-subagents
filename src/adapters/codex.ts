import type { AgentProfile, BrokerEnvironment, DelegateCompletionResult, DelegateRequest } from "../broker/types.js";
import { SessionStore } from "../store/sessions.js";
import { createLogger } from "../util/logging.js";
import { getStatePaths } from "../util/paths.js";
import {
  createOutputCaptureFile,
  fallbackEnv,
  parseJsonLines,
  readPromptFile,
  readIfExists,
  runCommand,
} from "./shared.js";

function extractSessionId(events: unknown[]): string | null {
  for (const event of events) {
    if (!event || typeof event !== "object") {
      continue;
    }

    const record = event as Record<string, unknown>;
    if (typeof record.thread_id === "string") {
      return record.thread_id;
    }

    if (typeof record.session_id === "string") {
      return record.session_id;
    }

    if (
      record.type === "thread.started" &&
      typeof record.thread_id === "string"
    ) {
      return record.thread_id;
    }

    if (
      record.type === "session.created" &&
      typeof record.session_id === "string"
    ) {
      return record.session_id;
    }

    if (
      typeof record.event === "object" &&
      record.event &&
      typeof (record.event as Record<string, unknown>).thread_id === "string"
    ) {
      return (record.event as Record<string, unknown>).thread_id as string;
    }

    if (
      typeof record.event === "object" &&
      record.event &&
      typeof (record.event as Record<string, unknown>).session_id === "string"
    ) {
      return (record.event as Record<string, unknown>).session_id as string;
    }
  }

  return null;
}

export interface CodexAdapterOptions {
  profile: AgentProfile;
  request: DelegateRequest;
  cwd: string;
  command?: string;
  sessionId?: string;
  providerHandle?: string | null;
  resume?: boolean;
  brokerEnvironment: BrokerEnvironment;
  sessionStore: SessionStore;
}

function buildCodexChildEnv(): NodeJS.ProcessEnv {
  const env = fallbackEnv({
    URBAN_SUBAGENTS_CHILD: "1"
  });
  delete env.BROKER_HOST_SESSION_ID;
  delete env.BROKER_HOST_RUNTIME;
  delete env.URBAN_SUBAGENTS_BROKER_COMMAND;
  delete env.URBAN_SUBAGENTS_BROKER_ARGS;
  return env;
}

function buildCodexPrompt(profile: AgentProfile, prompt: string): string {
  const instructions = readPromptFile(profile.promptFilePath).trim();
  if (!instructions) {
    return prompt;
  }

  return `${instructions}\n\nUser task:\n${prompt}`;
}

async function waitForInterruptedSession(
  sessionStore: SessionStore,
  sessionId: string,
  timeoutMs = 1500,
): Promise<ReturnType<SessionStore["getSession"]>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const session = sessionStore.getSession(sessionId);
    if (!session || session.status !== "running") {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return sessionStore.getSession(sessionId);
}

export async function runCodexDelegate(
  options: CodexAdapterOptions,
): Promise<DelegateCompletionResult> {
  const logger = createLogger("codex-adapter");
  const command = options.command ?? process.env.BROKER_CODEX_BIN ?? "codex";
  const prompt = buildCodexPrompt(options.profile, options.request.prompt);
  const captureFile = createOutputCaptureFile(
    getStatePaths(options.cwd).outputsDir,
    `codex-${options.profile.name}`,
  );
  const isResume = options.resume ?? Boolean(options.request.session_id);
  const sharedArgs = [
    "--json",
    "-o",
    captureFile,
    "--ignore-user-config",
    "--ignore-rules",
    "-c",
    `model="${options.profile.model}"`,
    "-c",
    `model_reasoning_effort="${options.profile.codex.reasoningEffort}"`,
    "-c",
    `approval_policy="${options.profile.codex.approvalPolicy}"`,
    "-c",
    `sandbox_mode="${options.profile.codex.sandboxMode}"`,
    "-c",
    "features.multi_agent=false",
    "-c",
    "agents.max_depth=1",
    "-c",
    "agents.max_threads=1",
    "-c",
    "project_doc_max_bytes=0",
    "--skip-git-repo-check",
  ];

  const resumeHandle = options.providerHandle ?? options.request.session_id ?? null;
  if (isResume && !resumeHandle) {
    throw new Error("Codex resume requires a provider handle.");
  }

  const args = isResume
    ? ["exec", "resume", ...sharedArgs, resumeHandle!, "-"]
    : ["exec", ...sharedArgs, "-"];

  let sessionId: string | null = options.sessionId ?? options.request.session_id ?? null;
  let providerHandle: string | null = resumeHandle;
  let rowCreated = false;
  let spawnedPid: number | null = null;

  const result = await runCommand({
    command,
    args,
    cwd: options.cwd,
    env: buildCodexChildEnv(),
    stdin: prompt,
    onSpawn(pid) {
      spawnedPid = pid;
      if (sessionId && !rowCreated) {
        options.sessionStore.createRunningSession({
          session_id: sessionId,
          provider_handle: providerHandle,
          runtime: "codex_exec",
          parent_session_id: options.brokerEnvironment.hostSessionId,
          parent_runtime: options.brokerEnvironment.hostRuntime,
          agent: options.profile.name,
          cwd: options.cwd,
          pid
        });
        options.sessionStore.addEvent({
          session_id: sessionId,
          kind: isResume ? "resume" : "start",
          payload: { runtime: "codex_exec", agent: options.profile.name }
        });
        rowCreated = true;
      }
    },
    onStdoutLine(line) {
      const events = parseJsonLines(line);
      const detected = extractSessionId(events);
      if (detected && !providerHandle) {
        providerHandle = detected;
        if (sessionId) {
          options.sessionStore.updateProviderHandle(sessionId, providerHandle);
        }
      }
      if (detected && !sessionId) {
        sessionId = detected;
      }

      if (sessionId && !rowCreated) {
        options.sessionStore.createRunningSession({
          session_id: sessionId,
          provider_handle: providerHandle,
          runtime: "codex_exec",
          parent_session_id: options.brokerEnvironment.hostSessionId,
          parent_runtime: options.brokerEnvironment.hostRuntime,
          agent: options.profile.name,
          cwd: options.cwd,
          pid: spawnedPid
        });
        options.sessionStore.addEvent({
          session_id: sessionId,
          kind: isResume ? "resume" : "start",
          payload: { runtime: "codex_exec", agent: options.profile.name }
        });
        rowCreated = true;
      }
    },
    onStderrLine(line) {
      logger.warn("Codex stderr", { line });
    }
  });

  const events = parseJsonLines(result.stdout);
  const detectedSession = extractSessionId(events);
  providerHandle = providerHandle ?? detectedSession;
  sessionId = sessionId ?? detectedSession;
  if (sessionId && providerHandle) {
    options.sessionStore.updateProviderHandle(sessionId, providerHandle);
  }
  const textResult = readIfExists(captureFile).trim();

  if (!sessionId) {
    throw new Error(result.stderr || "Codex did not emit a session ID.");
  }
  if (!providerHandle) {
    throw new Error(result.stderr || "Codex did not emit a provider handle.");
  }

  if (!rowCreated) {
    options.sessionStore.createRunningSession({
      session_id: sessionId,
      provider_handle: providerHandle,
      runtime: "codex_exec",
      parent_session_id: options.brokerEnvironment.hostSessionId,
      parent_runtime: options.brokerEnvironment.hostRuntime,
      agent: options.profile.name,
      cwd: options.cwd,
      pid: spawnedPid
    });
    options.sessionStore.addEvent({
      session_id: sessionId,
      kind: isResume ? "resume" : "start",
      payload: { runtime: "codex_exec", agent: options.profile.name }
    });
  }

  if (result.exitCode !== 0) {
    const interruptedSession = await waitForInterruptedSession(
      options.sessionStore,
      sessionId,
    );
    if (interruptedSession?.status === "interrupted") {
      const interruptedResult = (interruptedSession.result ?? textResult) || null;
      options.sessionStore.markSession(sessionId, "interrupted", {
        durationMs: result.durationMs,
        result: interruptedResult,
        error: interruptedSession.error
      });

      return {
        session_id: sessionId,
        provider_handle: interruptedSession.provider_handle ?? providerHandle,
        status: "interrupted",
        result: interruptedResult ?? "",
        duration_ms: result.durationMs,
        runtime: "codex_exec"
      };
    }

    const message = result.stderr || `Codex exited with code ${result.exitCode}.`;
    options.sessionStore.markSessionIfRunning(sessionId, "failed", {
      durationMs: result.durationMs,
      error: message,
      result: textResult || null
    });
    options.sessionStore.addEvent({
      session_id: sessionId,
      kind: "error",
      payload: { message, exitCode: result.exitCode }
    });
    throw new Error(message);
  }

  options.sessionStore.markSessionIfRunning(sessionId, "completed", {
    durationMs: result.durationMs,
    result: textResult
  });
  options.sessionStore.addEvent({
    session_id: sessionId,
    kind: "end",
    payload: { exitCode: result.exitCode }
  });

  return {
    session_id: sessionId,
    provider_handle: providerHandle,
    status: "completed",
    result: textResult,
    duration_ms: result.durationMs,
    runtime: "codex_exec"
  };
}
