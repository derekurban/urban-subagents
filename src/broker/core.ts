import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";

import type {
  BrokerEnvironment,
  DelegateRequest,
  ListSessionsOptions,
  Runtime,
  SessionRow,
} from "./types.js";
import { loadBrokerConfig } from "./config.js";
import { getAgentProfile, resolveAgentProfiles } from "./profiles.js";
import { runClaudeDelegate } from "../adapters/claude.js";
import { runCodexDelegate } from "../adapters/codex.js";
import { terminatePid } from "../adapters/shared.js";
import { runInit } from "../install/index.js";
import { openDatabase } from "../store/db.js";
import { SessionStore } from "../store/sessions.js";
import { createLogger } from "../util/logging.js";
import { getBrokerEnvironment, getStatePaths } from "../util/paths.js";

interface DelegateWorkerJob {
  version: 1;
  session_id: string;
  request: DelegateRequest;
  cwd: string;
  brokerEnvironment: BrokerEnvironment;
  resume: boolean;
  providerHandle: string | null;
  runtime: Runtime;
}

const CLI_COMMANDS = new Set([
  "serve-mcp",
  "install",
  "init",
  "doctor",
  "agents",
  "sessions",
  "delegate",
  "cancel",
  "reset",
  "worker"
]);

export class BrokerCore {
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly brokerEnvironment: BrokerEnvironment;
  private readonly db;
  private readonly sessionStore: SessionStore;

  constructor(
    private readonly cwd = process.cwd(),
    brokerEnvironment: BrokerEnvironment = getBrokerEnvironment(),
  ) {
    this.logger = createLogger("broker-core");
    this.brokerEnvironment = brokerEnvironment;
    this.db = openDatabase(this.cwd);
    this.sessionStore = new SessionStore(this.db);
    this.sessionStore.orphanCleanup();
  }

  close(): void {
    this.db.close();
  }

  private getConfig() {
    return loadBrokerConfig(this.cwd);
  }

  listAgents() {
    return resolveAgentProfiles(this.getConfig()).map((profile) => ({
      name: profile.name,
      description: profile.description,
      runtime: profile.runtime,
      permissions: profile.permissions,
      supports_resume: profile.supports_resume
    }));
  }

  listSessions(options: ListSessionsOptions = {}): SessionRow[] {
    return this.sessionStore.listSessions(
      options,
      this.brokerEnvironment.hostSessionId,
    );
  }

  getSession(sessionId: string): SessionRow {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session "${sessionId}".`);
    }

    return session;
  }

  private writeDelegateJob(job: DelegateWorkerJob): string {
    const jobsDir = getStatePaths(job.cwd).jobsDir;
    fs.mkdirSync(jobsDir, { recursive: true });
    const target = path.join(jobsDir, `${job.session_id}.json`);
    fs.writeFileSync(target, JSON.stringify(job, null, 2) + "\n", "utf8");
    return target;
  }

  private buildWorkerLaunch(jobPath: string): { command: string; args: string[] } {
    const command = process.env.URBAN_SUBAGENTS_BROKER_COMMAND ?? process.execPath;
    const argv = process.env.URBAN_SUBAGENTS_BROKER_ARGS
      ? JSON.parse(process.env.URBAN_SUBAGENTS_BROKER_ARGS) as string[]
      : process.argv.slice(1);
    const commandIndex = argv.findIndex((arg) => CLI_COMMANDS.has(arg));
    const prefix = commandIndex >= 0 ? argv.slice(0, commandIndex) : argv.slice(0, 1);
    return { command, args: [...prefix, "worker", "run", "--job", jobPath] };
  }

  private spawnWorker(jobPath: string, cwd: string): number | null {
    const launch = this.buildWorkerLaunch(jobPath);
    const child = crossSpawn(launch.command, launch.args, {
      cwd,
      env: process.env,
      stdio: "ignore",
      detached: true,
      windowsHide: true
    });
    child.once("error", (error) => {
      this.logger.warn("Delegate worker spawn failed", {
        jobPath,
        message: error.message
      });
      const sessionId = path.basename(jobPath, ".json");
      this.sessionStore.markSessionIfRunning(sessionId, "failed", {
        error: error.message
      });
      this.sessionStore.addEvent({
        session_id: sessionId,
        kind: "error",
        payload: { message: error.message }
      });
    });
    child.unref();
    return child.pid ?? null;
  }

  async delegate(request: DelegateRequest): Promise<SessionRow> {
    if (process.env.URBAN_SUBAGENTS_CHILD === "1") {
      throw new Error("Recursive delegation is disabled inside broker-managed child agents.");
    }

    const config = this.getConfig();
    const profile = getAgentProfile(config, request.agent);
    const cwd = request.cwd ?? this.cwd;
    const resume = Boolean(request.session_id);
    const existing = request.session_id
      ? this.sessionStore.getSession(request.session_id)
      : null;

    if (request.session_id && !existing) {
      throw new Error(`Unknown session "${request.session_id}".`);
    }
    if (existing?.status === "running") {
      throw new Error(`Session "${existing.session_id}" is already running.`);
    }

    const sessionId = existing?.session_id ?? randomUUID();
    const providerHandle =
      existing?.provider_handle ??
      (profile.runtime === "claude_code" ? sessionId : null);

    this.logger.info("Delegate request", {
      agent: request.agent,
      runtime: profile.runtime,
      cwd,
      sessionId,
      resume
    });

    this.sessionStore.createRunningSession({
      session_id: sessionId,
      provider_handle: providerHandle,
      runtime: profile.runtime,
      parent_session_id: this.brokerEnvironment.hostSessionId,
      parent_runtime: this.brokerEnvironment.hostRuntime,
      agent: profile.name,
      cwd,
      pid: null
    });
    this.sessionStore.addEvent({
      session_id: sessionId,
      kind: resume ? "resume" : "start",
      payload: { runtime: profile.runtime, agent: profile.name, async: true }
    });

    const jobPath = this.writeDelegateJob({
      version: 1,
      session_id: sessionId,
      request: { ...request },
      cwd,
      brokerEnvironment: this.brokerEnvironment,
      resume,
      providerHandle,
      runtime: profile.runtime
    });
    const pid = this.spawnWorker(jobPath, cwd);
    this.sessionStore.updatePid(sessionId, pid);

    return this.getSession(sessionId);
  }

  async runDelegateWorker(jobPath: string): Promise<void> {
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8")) as DelegateWorkerJob;
    const config = this.getConfig();
    const profile = getAgentProfile(config, job.request.agent);
    const request = { ...job.request };

    if (job.resume) {
      request.session_id = job.session_id;
    } else {
      delete request.session_id;
    }

    try {
      if (profile.runtime === "claude_code") {
        await runClaudeDelegate({
          profile,
          request,
          cwd: job.cwd,
          sessionId: job.session_id,
          providerHandle: job.providerHandle,
          resume: job.resume,
          brokerEnvironment: job.brokerEnvironment,
          sessionStore: this.sessionStore
        });
      } else {
        await runCodexDelegate({
          profile,
          request,
          cwd: job.cwd,
          sessionId: job.session_id,
          providerHandle: job.providerHandle,
          resume: job.resume,
          brokerEnvironment: job.brokerEnvironment,
          sessionStore: this.sessionStore
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sessionStore.markSessionIfRunning(job.session_id, "failed", {
        error: message
      });
      this.sessionStore.addEvent({
        session_id: job.session_id,
        kind: "error",
        payload: { message }
      });
      throw error;
    } finally {
      fs.rmSync(jobPath, { force: true });
    }
  }

  async cancel(sessionId: string, reason?: string) {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`Unknown session "${sessionId}".`);
    }

    if (session.pid) {
      await terminatePid(session.pid);
    }

    const message = reason ?? "Cancelled by broker request.";
    const durationMs = Math.max(0, Date.now() - session.created_at);
    this.sessionStore.markSession(sessionId, "interrupted", {
      durationMs,
      result: session.result,
      error: message
    });
    this.sessionStore.addEvent({
      session_id: sessionId,
      kind: "cancel",
      payload: { reason: message }
    });

    return {
      session_id: sessionId,
      status: "interrupted" as const
    };
  }

  reset(force = false): void {
    if (!force) {
      throw new Error("Reset requires --force.");
    }

    const statePaths = getStatePaths(this.cwd);
    this.sessionStore.reset();

    for (const target of [statePaths.logsDir, statePaths.outputsDir, statePaths.jobsDir]) {
      if (!fs.existsSync(target)) {
        continue;
      }

      for (const entry of fs.readdirSync(target)) {
        fs.rmSync(path.join(target, entry), { recursive: true, force: true });
      }
    }
  }

  async init(host: "all" | "claude" | "codex", dryRun = false, force = false) {
    return await runInit({
      cwd: this.cwd,
      host,
      dryRun,
      force
    });
  }
}
