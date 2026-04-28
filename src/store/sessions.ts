import Database from "better-sqlite3";

import type {
  CreateSessionInput,
  ListSessionsOptions,
  SessionEventInput,
  SessionRow,
  SessionStatus,
} from "../broker/types.js";

function now(): number {
  return Date.now();
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class SessionStore {
  constructor(private readonly db: Database.Database) {}

  createRunningSession(input: CreateSessionInput): void {
    const timestamp = now();
    this.db
      .prepare(
        `
        INSERT INTO sessions (
          session_id,
          provider_handle,
          runtime,
          parent_session_id,
          parent_runtime,
          agent,
          status,
          cwd,
          created_at,
          updated_at,
          ended_at,
          pid,
          duration_ms,
          result,
          error
        ) VALUES (
          @session_id,
          @provider_handle,
          @runtime,
          @parent_session_id,
          @parent_runtime,
          @agent,
          'running',
          @cwd,
          @created_at,
          @updated_at,
          NULL,
          @pid,
          NULL,
          NULL,
          NULL
        )
        ON CONFLICT(session_id) DO UPDATE SET
          provider_handle = excluded.provider_handle,
          runtime = excluded.runtime,
          parent_session_id = excluded.parent_session_id,
          parent_runtime = excluded.parent_runtime,
          agent = excluded.agent,
          status = 'running',
          cwd = excluded.cwd,
          updated_at = excluded.updated_at,
          ended_at = NULL,
          pid = excluded.pid,
          duration_ms = NULL,
          error = NULL
      `,
      )
      .run({
        ...input,
        created_at: timestamp,
        updated_at: timestamp
      });
  }

  addEvent(input: SessionEventInput): void {
    this.db
      .prepare(
        `
        INSERT INTO session_events (session_id, ts, kind, payload)
        VALUES (@session_id, @ts, @kind, @payload)
      `,
      )
      .run({
        session_id: input.session_id,
        ts: now(),
        kind: input.kind,
        payload: input.payload ? JSON.stringify(input.payload) : null
      });
  }

  updatePid(sessionId: string, pid: number | null): void {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET pid = ?, updated_at = ?
        WHERE session_id = ?
      `,
      )
      .run(pid, now(), sessionId);
  }

  updateProviderHandle(sessionId: string, providerHandle: string | null): void {
    this.db
      .prepare(
        `
        UPDATE sessions
        SET provider_handle = ?, updated_at = ?
        WHERE session_id = ?
      `,
      )
      .run(providerHandle, now(), sessionId);
  }

  markSession(
    sessionId: string,
    status: SessionStatus,
    fields: {
      durationMs?: number | null;
      result?: string | null;
      error?: string | null;
    } = {},
  ): void {
    const endedAt = status === "running" ? null : now();
    this.db
      .prepare(
        `
        UPDATE sessions
        SET
          status = @status,
          updated_at = @updated_at,
          ended_at = @ended_at,
          pid = CASE WHEN @status = 'running' THEN pid ELSE NULL END,
          duration_ms = @duration_ms,
          result = @result,
          error = @error
        WHERE session_id = @session_id
      `,
      )
      .run({
        session_id: sessionId,
        status,
        updated_at: now(),
        ended_at: endedAt,
        duration_ms: fields.durationMs ?? null,
        result: fields.result ?? null,
        error: fields.error ?? null
      });
  }

  markSessionIfRunning(
    sessionId: string,
    status: Exclude<SessionStatus, "running">,
    fields: {
      durationMs?: number | null;
      result?: string | null;
      error?: string | null;
    } = {},
  ): boolean {
    const result = this.db
      .prepare(
        `
        UPDATE sessions
        SET
          status = @status,
          updated_at = @updated_at,
          ended_at = @ended_at,
          pid = NULL,
          duration_ms = @duration_ms,
          result = @result,
          error = @error
        WHERE session_id = @session_id AND status = 'running'
      `,
      )
      .run({
        session_id: sessionId,
        status,
        updated_at: now(),
        ended_at: now(),
        duration_ms: fields.durationMs ?? null,
        result: fields.result ?? null,
        error: fields.error ?? null
      });

    return result.changes > 0;
  }

  getSession(sessionId: string): SessionRow | null {
    return (
      (this.db
        .prepare(
          `
          SELECT
            session_id,
            provider_handle,
            runtime,
            parent_session_id,
            parent_runtime,
            agent,
            status,
            cwd,
            created_at,
            updated_at,
            ended_at,
            pid,
            duration_ms,
            result,
            error
          FROM sessions
          WHERE session_id = ?
        `,
        )
        .get(sessionId) as SessionRow | undefined) ?? null
    );
  }

  listSessions(
    options: ListSessionsOptions = {},
    currentParentSessionId: string | null = null,
  ): SessionRow[] {
    const scope = options.scope ?? "current";
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (scope === "current" && currentParentSessionId) {
      clauses.push("parent_session_id = ?");
      params.push(currentParentSessionId);
    }

    if (options.agent) {
      clauses.push("agent = ?");
      params.push(options.agent);
    }

    if (options.status) {
      clauses.push("status = ?");
      params.push(options.status);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = options.limit ?? 50;

    return this.db
      .prepare(
        `
        SELECT
          session_id,
          provider_handle,
          runtime,
          parent_session_id,
          parent_runtime,
          agent,
          status,
          cwd,
          created_at,
          updated_at,
          ended_at,
          pid,
          duration_ms,
          result,
          error
        FROM sessions
        ${where}
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(...params, limit) as SessionRow[];
  }

  orphanCleanup(): number {
    const rows = this.db
      .prepare(
        `
        SELECT session_id, pid
        FROM sessions
        WHERE status = 'running' AND pid IS NOT NULL
      `,
      )
      .all() as Array<{ session_id: string; pid: number }>;

    let updated = 0;
    for (const row of rows) {
      if (row.pid && !isPidAlive(row.pid)) {
        const message = `orphan cleanup: process ${row.pid} not found`;
        this.markSession(row.session_id, "interrupted", { error: message });
        this.addEvent({
          session_id: row.session_id,
          kind: "error",
          payload: { message }
        });
        updated += 1;
      }
    }

    return updated;
  }

  reset(): void {
    this.db.exec(`
      DELETE FROM session_events;
      DELETE FROM sessions;
      VACUUM;
    `);
  }
}
