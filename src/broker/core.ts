import fs from "node:fs";
import path from "node:path";

import type {
  BrokerEnvironment,
  DelegateRequest,
  DelegateResult,
  ListSessionsOptions,
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

  async delegate(request: DelegateRequest): Promise<DelegateResult> {
    const config = this.getConfig();
    const profile = getAgentProfile(config, request.agent);
    const cwd = request.cwd ?? this.cwd;

    this.logger.info("Delegate request", {
      agent: request.agent,
      runtime: profile.runtime,
      cwd
    });

    if (profile.runtime === "claude_code") {
      return await runClaudeDelegate({
        profile,
        request,
        cwd,
        brokerEnvironment: this.brokerEnvironment,
        sessionStore: this.sessionStore
      });
    }

    return await runCodexDelegate({
      profile,
      request,
      cwd,
      brokerEnvironment: this.brokerEnvironment,
      sessionStore: this.sessionStore
    });
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

    for (const target of [statePaths.logsDir, statePaths.outputsDir]) {
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
