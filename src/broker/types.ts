export type Runtime = "claude_code" | "codex_exec";

export type HostRuntime = "claude" | "codex" | null;

export type SessionStatus =
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "interrupted";

export interface RawAgentProfile {
  description: string;
  runtime: Runtime;
  model: string;
  prompt_file: string;
}

export interface RawBrokerConfig {
  version?: string | number;
  broker?: {
    execution_mode?: "sync";
    default_output?: {
      format?: "text";
    };
  };
  agents: Record<string, RawAgentProfile>;
}

export interface BrokerConfig {
  path: string;
  source: "user" | "project";
  version: string;
  broker: {
    execution_mode: "sync";
    default_output: {
      format: "text";
    };
  };
  agents: Record<string, RawAgentProfile>;
}

export interface ClaudeProfileDefaults {
  tools: string[];
  permissionMode: "bypassPermissions" | "dontAsk";
  effort: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface CodexProfileDefaults {
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "never" | "on-request" | "on-failure";
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh";
}

export interface AgentProfile extends RawAgentProfile {
  name: string;
  promptFilePath: string;
  permissions: string[];
  supports_resume: true;
  claude: ClaudeProfileDefaults;
  codex: CodexProfileDefaults;
}

export interface DelegateRequest {
  agent: string;
  prompt: string;
  session_id?: string;
  cwd?: string;
  context?: Record<string, unknown>;
}

export interface DelegateResult {
  session_id: string;
  status: SessionStatus;
  result: string;
  provider_handle: string;
  duration_ms: number;
  runtime: Runtime;
}

export interface SessionRow {
  session_id: string;
  provider_handle: string;
  runtime: Runtime;
  parent_session_id: string | null;
  parent_runtime: HostRuntime;
  agent: string;
  status: SessionStatus;
  cwd: string;
  created_at: number;
  updated_at: number;
  ended_at: number | null;
  pid: number | null;
  duration_ms: number | null;
  result: string | null;
  error: string | null;
}

export interface ListSessionsOptions {
  scope?: "current" | "all";
  limit?: number;
  agent?: string;
  status?: SessionStatus;
}

export interface CreateSessionInput {
  session_id: string;
  provider_handle: string;
  runtime: Runtime;
  parent_session_id: string | null;
  parent_runtime: HostRuntime;
  agent: string;
  cwd: string;
  pid: number | null;
}

export interface SessionEventInput {
  session_id: string;
  kind: "start" | "output" | "error" | "resume" | "cancel" | "end";
  payload?: Record<string, unknown>;
}

export interface BrokerEnvironment {
  hostSessionId: string | null;
  hostRuntime: HostRuntime;
}
