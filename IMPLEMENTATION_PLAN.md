# urban-subagents — Implementation Plan

## Context

We're building `urban-subagents`, a cross-provider sub-agent broker that replaces native sub-agent delegation in both Claude Code and Codex CLI with a unified MCP broker. The broker owns the canonical API, session registry, and provider selection; Claude Code and Codex remain the execution backends.

**Why this exists:** Claude and Codex each ship their own native subagent system, but the two can't share sessions, profiles, or lifecycle. A Claude session can't resume a Codex thread; a Codex session can't delegate to a Claude subagent with the same profile definition. The broker provides one `delegate` API and one session registry that both hosts plug into, enabling cross-provider profiles (e.g., a `reviewer` agent that could run on either Codex or Claude) and letting either host observe and resume sessions created by the other.

**The user's decision:** strict Mode 3 — replace native subagent delegation with the broker MCP by disabling native subagent dispatch. Verified that both hosts expose real kill switches (`permissions.deny: ["Agent"]` on Claude; `[features] multi_agent = false` on Codex). The remaining requirement is host steering: natural-language delegation requests must map to the broker MCP tools rather than falling back to inline work.

**Outcome goals:**
- One-command install that wires both hosts automatically with a doctor command to verify
- Broker auto-lifecycled per session via stdio MCP (no daemon the user manages)
- Durable SQLite-backed session registry shared across concurrent Claude and Codex sessions; sessions remain resumable indefinitely
- Minimal YAML agent profiles (start simple, expand as use demands)
- Tool-surface restriction for broker-spawned children via adapter-level defaults (reviewers read-only, etc.)

---

## Architecture

```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│  Claude Code session         │      │  Codex CLI session           │
│  - native Agent denied       │      │  - multi_agent=false         │
│  - CLAUDE.md broker guidance │      │  - global AGENTS.md guidance │
│  - MCP client (stdio)        │      │  - MCP client (stdio)        │
└──────────────┬───────────────┘      └──────────────┬───────────────┘
               │ spawns per session                   │ spawns per session
               ▼                                      ▼
        ┌─────────────────────────────────────────────────────┐
        │  agent-broker serve-mcp  (stdio MCP server)         │
        │  - list_agents / list_sessions / delegate / cancel  │
        └──────────────────────┬──────────────────────────────┘
                               │
                 ┌─────────────┴──────────────┐
                 ▼                            ▼
         ┌─────────────────┐          ┌─────────────────┐
         │ Claude adapter  │          │ Codex adapter   │
         │ spawns claude -p│          │ spawns codex    │
         │ --tools …       │          │ exec --json     │
         │ --resume …      │          │ resume …        │
         └────────┬────────┘          └────────┬────────┘
                  │                            │
                  └────────────┬───────────────┘
                               ▼
                    ┌─────────────────────┐
                    │  SQLite session DB  │
                    │  ~/.urban-subagents │
                    │  /sessions.db       │
                    └─────────────────────┘
```

- **Stdio MCP, one process per host session** — the client (Claude or Codex) spawns `agent-broker serve-mcp --host-runtime <claude|codex>` on session start and kills it on exit. No daemon, no lifecycle burden.
- **Shared state via SQLite (WAL mode)** — concurrent broker processes coordinate through the database file. A Codex-created session is visible in a Claude session's `list_sessions`.
- **Adapters spawn provider subprocesses** — `claude -p` and `codex exec --json` for one-shot runs. Each child is given a restricted tool surface per the profile's permissions, captures the provider's native session handle for future resume, and exits when done.

---

## Repo Layout

```
urban-subagents/
├── package.json                  # npm: urban-subagents, bin: agent-broker
├── tsconfig.json
├── README.md
├── CURRENT_CONTEXT.md            # (existing, keep)
├── broker-vision.html            # (existing, keep)
│
├── src/
│   ├── cli/
│   │   └── index.ts              # command router: serve-mcp | init | doctor | agents | sessions | delegate | cancel
│   │
│   ├── mcp/
│   │   └── server.ts             # stdio MCP server (@modelcontextprotocol/sdk)
│   │
│   ├── broker/
│   │   ├── core.ts               # delegate(), list_agents(), list_sessions(), cancel()
│   │   ├── config.ts             # YAML loader + schema validation (zod)
│   │   └── profiles.ts           # agent profile resolution
│   │
│   ├── adapters/
│   │   ├── claude.ts             # spawn claude -p with flags, capture session_id, resume
│   │   ├── codex.ts              # spawn codex exec --json, capture thread/session id, resume
│   │   └── shared.ts             # subprocess helpers, stderr piping, timeout, cancel
│   │
│   ├── store/
│   │   ├── db.ts                 # better-sqlite3 connection, WAL mode, migrations
│   │   ├── sessions.ts           # CRUD for session rows
│   │   └── schema.sql            # tables + indices
│   │
│   ├── install/
│   │   ├── claude.ts             # writes ~/.claude/settings.json + ~/.claude/CLAUDE.md + ~/.claude.json idempotently
│   │   ├── codex.ts              # writes ~/.codex/config.toml + hooks.json
│   │   ├── detect.ts             # locates binaries, current configs, plugin state
│   │   └── backup.ts             # timestamped backups before any write
│   │
│   ├── doctor/
│   │   ├── checks.ts             # runnable validation steps
│   │   └── report.ts             # render pass/fail/fix-suggestion
│   │
│   └── util/
│       ├── paths.ts              # URBAN_SUBAGENTS_HOME resolution, per-project override
│       ├── toml.ts               # TOML read/merge/write (uses @iarna/toml or similar)
│       └── logging.ts            # structured logs to ~/.urban-subagents/logs/
│
├── plugin/                       # optional Claude plugin bundle
│   ├── .claude-plugin/
│   │   └── plugin.json           # name, version, references to .mcp.json + hooks/hooks.json
│   ├── .mcp.json                 # auto-registers broker MCP on plugin enable
│   ├── hooks/hooks.json          # PreToolUse → block-native-agent.mjs
│   ├── scripts/
│   │   └── block-native-agent.mjs
│   └── bin/                      # (optional) agent-broker entry on PATH
│
├── config/
│   └── agents.example.yaml       # example profile catalog
│
├── prompts/
│   ├── reviewer.md
│   └── planner.md
│
├── schemas/
│   └── delegate-result.json      # JSON schema for structured delegate output
│
└── tests/
    ├── unit/
    │   ├── config.test.ts
    │   ├── profiles.test.ts
    │   ├── store.test.ts
    │   └── adapters.test.ts
    ├── integration/
    │   ├── claude-spawn.test.ts  # real claude -p, mocked model via CLAUDE_CODE_USE_SIMULATED_MODEL if available
    │   ├── codex-spawn.test.ts
    │   └── end-to-end.test.ts
    └── fixtures/
        └── mock-provider-cli/    # stub CLI that mimics claude -p / codex exec --json for fast tests
```

---

## Core Components

### MCP server (`src/mcp/server.ts`)

Uses `@modelcontextprotocol/sdk/server/stdio`. Registers four tools:

| Tool | Input | Output |
|------|-------|--------|
| `list_agents` | (none) | Array of `{name, description, runtime, permissions, supports_resume}` |
| `list_sessions` | `{scope?: "current"\|"all", limit?: number}` | Array of session rows |
| `delegate` | `{agent: string, prompt: string, session_id?: string, cwd?: string, context?: object}` | `{session_id, status, result, provider_handle, duration_ms}` |
| `cancel` | `{session_id: string, reason?: string}` | `{session_id, status: "interrupted"}` |

Tool descriptions include explicit "use this instead of the native Agent tool" language so the host has a broker-first replacement surface even when native subagent dispatch is disabled.

Session scoping: a broker process is spawned per host session. For interactive host launches, the installed Claude and Codex MCP registrations pass `--host-runtime <claude|codex>` so the broker can stamp a synthetic host session id for that MCP process. `list_sessions` defaults to `scope: "current"` which filters by that host session id; `scope: "all"` returns everything. Explicit `BROKER_HOST_SESSION_ID` / `BROKER_HOST_RUNTIME` env vars remain supported for tests and future host integrations.

### Session store (`src/store/schema.sql`)

SQLite WAL mode. One database at `~/.urban-subagents/sessions.db`. The provider's session UUID is the primary key.

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,          -- provider session UUID
                                        --   Claude: broker-generated, passed via `claude --session-id <uuid>`
                                        --   Codex: captured from the first thread/session event
  runtime TEXT NOT NULL,                -- 'claude_code' | 'codex_exec'
  parent_session_id TEXT,               -- the host (Claude or Codex) session that invoked delegate
  parent_runtime TEXT,                  -- 'claude' | 'codex' | NULL (direct CLI invocation)
  agent TEXT NOT NULL,                  -- profile name
  status TEXT NOT NULL,                 -- 'running'|'idle'|'completed'|'failed'|'interrupted'
  cwd TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pid INTEGER,                          -- child subprocess pid while running
  error TEXT                            -- failure message if status in ('failed','interrupted')
);

CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_sessions_agent ON sessions(agent);
CREATE INDEX idx_sessions_status ON sessions(status);

CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,                   -- 'start'|'output'|'error'|'resume'|'cancel'|'end'
  payload TEXT                          -- JSON
);
```

**Key acquisition flow:**
- **Claude delegate**: broker calls `crypto.randomUUID()`, passes `--session-id <uuid>`, INSERTs the row with `status='running'` before `spawn()` returns. Row exists from the moment the subprocess starts.
- **Codex delegate**: broker spawns `codex exec --json`, reads the first stream event to capture the Codex-generated thread/session handle, then INSERTs. Transient state (agent name, pid, cwd, parent info) is held in memory for the ~tens-of-ms gap. If the subprocess dies before emitting the handle, the delegate returns an error with no row written.

**Concurrency:** WAL mode lets multiple broker processes read simultaneously; writes serialize via SQLite's lock. `better-sqlite3` is synchronous and fits per-process use — each broker opens the DB on startup and closes on exit.

**Durability / retention:** sessions are never auto-pruned. A broker session created weeks ago remains resumable by its parent Claude or Codex session. The only automatic write against older rows is **orphan cleanup on startup**: rows with `status='running'` whose `pid` no longer exists in the OS are transitioned to `status='interrupted'` with `error='orphan cleanup: process <pid> not found on broker startup'`. This corrects metadata left behind by crashes, SIGKILL, or system reboots without deleting any data.

Users who want to prune can use `agent-broker sessions delete <session_id>` explicitly (v1.1) or manipulate the DB directly.

### Claude adapter (`src/adapters/claude.ts`)

```ts
spawn('claude', [
  '-p', prompt,
  '--output-format', 'json',
  '--session-id', generatedUuid,         // UUID we control
  ...(resume ? ['--resume', priorId] : []),
  '--tools', profile.tools.join(','),    // restrict child's tool surface
  '--disallowedTools', 'Agent',          // prevent recursion into broker-shim
  '--strict-mcp-config',                 // only our MCP config, no inheritance
  '--mcp-config', childMcpConfigPath,    // minimal — usually empty or read-only MCPs
  '--bare',                              // skip plugins/skills/hooks/CLAUDE.md auto-discovery
  '--append-system-prompt-file', profile.promptFile,
  '--model', profile.model,
  '--effort', profile.effort,
  '--permission-mode', profile.permissionMode ?? 'bypassPermissions',
  '--max-turns', String(profile.maxTurns ?? 20),
  '--no-session-persistence',            // broker owns persistence
])
```

The `--bare` flag is load-bearing: it stops the child from rediscovering the broker's own hooks/plugin, which would otherwise block the child's own legitimate tool calls. `--strict-mcp-config` means no inherited MCP servers leak in.
For the opt-in real acceptance suite, an acceptance-only Claude mode is allowed to drop `--bare` so the installed OAuth-backed CLI can be exercised. That mode keeps `--strict-mcp-config`, keeps `--disallowedTools Agent`, disables slash commands, and narrows setting sources to preserve as much isolation as possible while remaining auth-compatible.

Output parsing: `claude -p --output-format json` emits a single JSON object at end with `session_id`, `result`, `total_cost_usd`, etc. Capture `session_id` → `provider_session_id` column. Handle the `stream-json` format as a streaming option for long-running delegates if needed.

### Codex adapter (`src/adapters/codex.ts`)

```ts
spawn('codex', [
  'exec',
  '--json',
  '--profile', profile.codexProfileName,  // profile defined in ~/.codex/config.toml
  ...(resume ? ['resume', priorSessionId] : []),
  // tool surface restriction comes via the profile's sandbox_mode + approval_policy
  '-c', 'features.multi_agent=false',     // prevent child from spawning
  '-c', 'agents.max_depth=1',
  '-c', 'agents.max_threads=1',
], { stdin: prompt })
```

Codex profile for each broker agent is written into `~/.codex/config.toml` during `agent-broker init` so `--profile reviewer` resolves correctly. Tool restriction on Codex is coarser than Claude (sandbox_mode + approval_policy + per-server `enabled_tools`/`disabled_tools`), so profiles document the realistic restriction level honestly.

Session resume: capture the provider handle from the JSON output stream. Current Codex emits `thread.started` with `thread_id`. Use `codex exec resume <HANDLE>` on resume calls.

### Config loader (`src/broker/config.ts`)

YAML at `~/.urban-subagents/config.yaml` (per-user default) overridable by `./.urban-subagents/config.yaml` (per-project). Schema validated with zod. Example:

```yaml
version: 0.1
broker:
  execution_mode: sync
  default_output: { format: text }

agents:
  reviewer:
    description: Read-only code review
    runtime: codex_exec              # or claude_code
    model: gpt-5.4                   # or 'opus'/'sonnet' for Claude
    reasoning_effort: high           # optional: minimal|low|medium|high|xhigh|max
    prompt_file: prompts/reviewer.md

  planner:
    description: Generate implementation plans
    runtime: claude_code
    model: opus
    reasoning_effort: high
    prompt_file: prompts/planner.md
```

v1 keeps the profile schema intentionally minimal — `description`, `runtime`, `model`, optional `reasoning_effort`, and `prompt_file` per agent. `reasoning_effort` defaults to `high`; Claude maps `minimal` to `low`, and Codex maps `max` to `xhigh`. Additional knobs (tool restrictions, sandbox mode, permissions, max_turns, structured output schemas) get sensible per-runtime defaults baked into the adapter and can be lifted into the config once real use shapes what's worth exposing. A profile targets one runtime at a time; cross-runtime profiles are a future direction.

---

## CLI Command Surface

```
agent-broker serve-mcp              # stdio MCP server — invoked by hosts, not humans
agent-broker install [--host all|claude|codex] [--force] [--skip-doctor] [--json]
agent-broker init [--host all|claude|codex] [--dry-run] [--force]
agent-broker doctor [--verbose] [--fix]
agent-broker agents list
agent-broker sessions list [--scope current|all] [--agent NAME] [--status STATUS]
agent-broker delegate --agent NAME [--session SESSION_ID] --prompt TEXT
agent-broker cancel --session SESSION_ID [--reason TEXT]
agent-broker reset [--force]        # wipes state DB and logs (explicit nuke only)
```

Humans use `install`, `init`, `doctor`, `agents list`, `sessions list`, `cancel`, `reset`. The MCP server is the agent-facing surface. The admin CLI shares the broker core — same code path, different transport.

Notably absent: no automatic prune command. Data is kept indefinitely; `reset` is the explicit opt-in wipe.

---

## Mode 3 Enforcement

### Claude Code

Written to `~/.claude/settings.json` (user scope):

```json
{
  "permissions": {
    "deny": ["Agent"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/block-native-agent.mjs\""
          }
        ]
      }
    ]
  }
}
```

The hook (`block-native-agent.mjs`) remains a best-effort backstop. It reads stdin JSON, extracts `tool_input.subagent_type`, and writes:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Native Agent is disabled under urban-subagents Mode 3. Use mcp__urban-subagents__delegate with agent=\"<subagent_type>\" and prompt=\"<your prompt>\" instead. Run `mcp__urban-subagents__list_agents` to see available profiles."
  }
}
```

In practice, current interactive Claude behavior is more reliable when steering comes from managed project instructions instead of relying on the native `Agent` tool to be visible and interceptable. The enforced kill switch remains `permissions.deny`.

Written to `~/.claude/CLAUDE.md`:

```markdown
<!-- urban-subagents -->
## Delegation

Native Claude subagent delegation is disabled in this project. When the user asks you to delegate work, use a subagent, review code, create a plan, research in parallel, or split work into a child task, do not say delegation is unavailable.

Instead:
1. Call `mcp__urban-subagents__list_agents` to inspect the available broker-managed profiles.
2. Choose the best matching profile for the task.
3. Call `mcp__urban-subagents__delegate` with that `agent` name and a focused delegated prompt.

Do not treat `TaskCreate`, `TaskGet`, `TaskList`, `TaskOutput`, `TaskStop`, or `TaskUpdate` as a replacement for broker delegation.
<!-- /urban-subagents -->
```

**MCP registration** via `~/.claude.json` under `mcpServers.urban-subagents` for the CLI-managed user-scope install, or via `claude mcp add --transport stdio --scope user urban-subagents -- agent-broker serve-mcp --host-runtime claude` if the user wants Claude itself to manage that entry.

### Codex CLI

Written to `~/.codex/config.toml`:

```toml
[features]
multi_agent = false          # disables spawn_agent, send_input, resume_agent, wait_agent, close_agent
codex_hooks = true           # enable hooks for future interception

[agents]
max_depth = 1
max_threads = 1

[mcp_servers.urban-subagents]
command = "agent-broker"
args = ["serve-mcp", "--host-runtime", "codex"]

[profiles.reviewer]
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
approval_policy = "never"

[profiles.planner]
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
approval_policy = "never"
```

An `AGENTS.md` fragment gets written to `~/.codex/AGENTS.md` (or merged if one exists):

```markdown
## Subagent Delegation

Native subagent dispatch is disabled on this machine. When the user asks you to delegate work, use a subagent, review code, create a plan, research in parallel, or split work into a child task, use the broker MCP tools instead of native multi-agent APIs.

Required flow:
1. Run `mcp__urban-subagents__list_agents` to inspect available profiles.
2. Choose the best matching profile.
3. Run `mcp__urban-subagents__delegate` with that `agent` name and a focused delegated prompt.

Do not claim delegation is unavailable when the broker MCP tools are present.
Do not use `spawn_agent`, `send_input`, or any other native spawn tool — they have been disabled by config.
```

Belt-and-suspenders: `multi_agent=false` blocks at tool-surface level; global `AGENTS.md` blocks at natural-language level. Current Codex rejects zero for `agents.max_depth` / `agents.max_threads`, so the broker uses the minimum valid values while relying on `features.multi_agent=false` as the actual kill switch.

### Spawned-child restriction

When the broker spawns a Claude or Codex child (via `delegate`), the child itself must also be prevented from spawning further subagents or re-entering the broker. Enforced via:

- **Claude child**: `--disallowedTools "Agent,TaskCreate,TaskGet,TaskUpdate,TaskDelete"` + `--strict-mcp-config --mcp-config <empty-or-readonly-servers.json>` + `--bare` in strict mode
- **Codex child**: isolated `CODEX_HOME`, `--ignore-user-config`, `--ignore-rules`, `-c features.multi_agent=false`, `-c agents.max_depth=1`, `-c agents.max_threads=1`, and `-c project_doc_max_bytes=0`
- **Broker re-entry guard**: both adapters set `URBAN_SUBAGENTS_CHILD=1`; `BrokerCore.delegate()` rejects delegate calls made from broker-managed child agents.

---

## Install Flow (`agent-broker init`)

1. **Detect** — locate `claude` and `codex` binaries, read existing `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`, check for existing `urban-subagents` entries.
2. **Back up** — for any file we're about to touch, copy to `~/.urban-subagents/backups/<timestamp>/<original-path>`.
3. **Prompt** — unless `--force`, show a diff of intended changes and ask for confirmation per file. `--dry-run` prints the diff and exits.
4. **Write Claude config** — merge `permissions.deny`, the optional `hooks.PreToolUse` backstop, the managed `~/.claude/CLAUDE.md` delegation block, and a user `~/.claude.json` entry under `mcpServers.urban-subagents` that launches `serve-mcp --host-runtime claude`.
5. **Write Codex config** — merge TOML sections. `[features] multi_agent = false`, `[agents] max_depth = 1`, `[agents] max_threads = 1`, `[mcp_servers.urban-subagents]` block launching `serve-mcp --host-runtime codex`, per-profile `[profiles.<name>]` blocks from config.yaml.
6. **Write AGENTS.md** — append the delegation instruction block to `~/.codex/AGENTS.md` (create if missing) with a clearly marked `<!-- urban-subagents --><!-- /urban-subagents -->` pair so uninstall can find and remove it.
7. **Create state** — ensure `~/.urban-subagents/{config.yaml,sessions.db,logs/,backups/,outputs/}` exist. Initialize SQLite schema via migrations.
8. **Write default config.yaml** — if none exists, write `config/agents.example.yaml` as the starting point.
9. **Report** — success summary, next-steps link to `agent-broker doctor`.

Idempotency: every write uses marker comments (`# urban-subagents-begin`/`# urban-subagents-end` for TOML; `<!-- urban-subagents -->` for Markdown) so re-running `init` detects and updates only the managed section, leaves everything else untouched.

---

## Doctor Flow (`agent-broker doctor`)

Checks, each pass/fail/warn with a fix suggestion:

1. **Binaries** — `claude --version` and `codex --version` run successfully; supported version floors met.
2. **Claude settings** — `~/.claude/settings.json` parses; `permissions.deny` contains `"Agent"`. Hook presence is optional.
3. **Claude MCP config** — `~/.claude.json` parses and registers `mcpServers.urban-subagents` with a command and args.
4. **CLAUDE.md** — `~/.claude/CLAUDE.md` exists and contains the managed broker instruction block.
5. **Codex config** — `~/.codex/config.toml` parses; `features.multi_agent == false`; `agents.max_depth == 1`; `agents.max_threads == 1`; `mcp_servers.urban-subagents.command` resolvable on PATH; per-profile blocks match `config.yaml`.
6. **AGENTS.md** — exists and contains the marker block.
7. **MCP smoke test** — spawn `agent-broker serve-mcp`, send an `initialize` + `tools/list` via stdio, confirm the four tools respond, kill.
8. **State directory** — writable, `sessions.db` exists and WAL mode active, schema version matches.
9. **Provider smoke test** (`--verbose` only) — run `claude -p --output-format json "echo ok"` with minimal flags, confirm JSON parse and `session_id` capture. Same for `codex exec --json "echo ok"`, accepting either `session_id` or `thread_id` as the provider handle.
10. **Orphan sweep** — for rows where `status='running'` but the `pid` no longer exists in the OS, transition to `interrupted` with an explanatory error. Non-destructive metadata correction; runs every doctor invocation, not opt-in.
11. **Auto-fix** (`--fix` only) — for detectable drift (missing deny entry, malformed Claude MCP registration, missing feature flag, missing instruction block), re-apply `init`'s writes for the drifted keys only.

Exit code 0 if all pass; non-zero if any fail. Output is rendered as a grouped report.

---

## Distribution

**Primary:** npm package `urban-subagents`, bootstrapped via `npx --yes urban-subagents@latest install --host all`. The bootstrap command installs or upgrades a persistent global copy with `npm install -g`, then re-executes the installed `agent-broker` binary to run `init` and `doctor`. When launched through `npm exec` / `npx --package=...`, the bootstrap reuses the original package source spec so GitHub repo specs and release tarball URLs can also promote themselves to a persistent global install. Generated host config points at the persistent installed broker, not transient `npx` cache paths.

**Secondary (optional):** Claude Code plugin at `plugin/`. The plugin's `.mcp.json` references `agent-broker` on PATH (installed by npm first) OR bundles the compiled `.mjs` at `${CLAUDE_PLUGIN_ROOT}/bin/agent-broker.mjs`. The plugin version auto-registers the MCP server and hooks on plugin enable — best UX for Claude-only users, but Codex-side still needs the CLI's `init` command.

**Recommended user flow:**
```bash
npx --yes urban-subagents@latest install --host all --force
# done — next Claude or Codex session routes through the broker
```

Alternative GitHub-release flow:

```bash
npx --yes --package=https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/urban-subagents-X.Y.Z.tgz agent-broker install --host all --force
```

Low-level flow remains available:

```bash
npm install -g urban-subagents
agent-broker init --host all --force
agent-broker doctor --host all --verbose
```

---

## Local Testing

### Unit tests (Vitest)
- `config.test.ts` — YAML parsing, schema validation, per-project overrides
- `profiles.test.ts` — resolution of agent profiles, defaults, runtime-specific knob translation
- `store.test.ts` — SQLite schema migration, CRUD, concurrent-write behavior (spawn two workers)
- `adapters.test.ts` — command-line argument construction for each provider, output parsing, session_id capture (mocked subprocess via fixtures)
- `install.test.ts` — idempotent settings.json merging, TOML merge/round-trip, marker-block handling

### Integration tests (Vitest, tagged `@integration`)
- `mock-provider-cli/` — a small Node CLI at `tests/fixtures/mock-provider-cli/` that mimics `claude -p --output-format json` and `codex exec --json` output shapes. The broker is pointed at these via a test-only `BROKER_CLAUDE_BIN` / `BROKER_CODEX_BIN` env override.
- `claude-spawn.test.ts` / `codex-spawn.test.ts` — delegate → subprocess → JSON parse → session row written. Session resume: second delegate with same session_id uses `--resume` flag and updates the row.
- `end-to-end.test.ts` — spawn the MCP server as a subprocess, speak MCP over stdio, call `list_agents`/`delegate`/`list_sessions`/`cancel`. Validates the full wire surface.

### Real acceptance tests (Vitest, opt-in local only)
- `tests/acceptance/phase1/` — black-box acceptance against the real installed `claude` / `codex` CLIs using the public `agent-broker` CLI and MCP server in an isolated scratch workspace.
- `tests/acceptance/phase2/` — scenario coverage for resume, cross-session scoping, cancel, and read-only tool restriction, plus acceptance-only provider delay proxies used to make cancel deterministic.
- Gating:
  - `RUN_REAL_ACCEPTANCE=1` enables the suite.
  - `RUN_REAL_CLAUDE=1` or `RUN_REAL_CODEX=1` can restrict provider coverage.
  - `URBAN_SUBAGENTS_REAL_CLAUDE_BIN` and `URBAN_SUBAGENTS_REAL_CODEX_BIN` can override the real provider binaries.

### Manual / semi-manual tests (documented in `tests/README.md`)
- **Real Claude host replacement** — wire `init` in a scratch directory, open a Claude session, ask for delegation in natural language, verify Claude uses the broker MCP tools instead of saying delegation is unavailable or attempting native subagents.
- **Real Codex host replacement** — same but in a Codex session. Verify the tool isn't available and the agent falls back to the broker MCP.
- **Cross-session visibility** — in terminal A start a Claude session, trigger a delegate. In terminal B start a Codex session, run `mcp__urban-subagents__list_sessions` and confirm the session from A is visible (scope=all).
- **Tool restriction** — delegate to a profile with `tools: [Read, Grep, Glob]` and confirm the child refuses to write files (via broker output log).
- **Cancel** — delegate a long-running task, call `cancel`, confirm child is killed and session row marked `interrupted`.

### Test infrastructure

- `tests/fixtures/mock-provider-cli/claude.mjs` and `codex.mjs`: stub binaries that read flags, echo a controllable JSON response, sleep configurably. Driven by env vars so a single binary covers multiple test scenarios.
- `tests/setup.ts`: creates an isolated `URBAN_SUBAGENTS_HOME` under a tmpdir per test suite, tears down afterwards.
- CI: GitHub Actions matrix on `ubuntu-latest` and `windows-latest` (both platforms matter — Windows named-pipe handling for stdio MCP can surface platform-specific bugs). Node 20 and 22.

---

## Critical Files (to create)

| Path | Purpose |
|------|---------|
| `package.json` | npm package + `bin: { "agent-broker": "./dist/cli.mjs" }` |
| `src/cli/index.ts` | Command router |
| `src/mcp/server.ts` | Stdio MCP server |
| `src/broker/core.ts` | `delegate`, `list_agents`, `list_sessions`, `cancel` |
| `src/adapters/claude.ts` | `claude -p` subprocess management |
| `src/adapters/codex.ts` | `codex exec` subprocess management |
| `src/store/schema.sql` | SQLite DDL |
| `src/store/sessions.ts` | Session CRUD |
| `src/install/claude.ts` | Settings/MCP writer for Claude side |
| `src/install/codex.ts` | config.toml + AGENTS.md writer |
| `src/doctor/checks.ts` | Validation suite |
| `plugin/scripts/block-native-agent.mjs` | PreToolUse hook script |
| `plugin/.claude-plugin/plugin.json` | Plugin manifest |
| `plugin/.mcp.json` | Plugin MCP registration |
| `plugin/hooks/hooks.json` | Plugin hooks registration |
| `config/agents.example.yaml` | Default profile catalog |
| `prompts/reviewer.md`, `prompts/planner.md` | Built-in profile prompts |

---

## Reusable Patterns from OpenAI Codex Plugin

The OpenAI plugin at `C:\Users\derek\.claude\plugins\cache\openai-codex\codex\1.0.3\` is a proven reference. Patterns to mirror (not copy wholesale — clean-room build):

- Hook script stdin/stdout conventions (`session-lifecycle-hook.mjs` at `scripts/session-lifecycle-hook.mjs:22-39`)
- `$CLAUDE_ENV_FILE` env-var injection on SessionStart (useful reference only; the current implementation does not depend on it for host session scoping)
- Workspace root resolution via `git rev-parse` → parent traversal (`scripts/lib/workspace.mjs`)
- Detached child spawn with `unref()` + log-fd pattern (`scripts/lib/broker-lifecycle.mjs:59-70`) — useful if we ever need a shared daemon
- Structured output schema under `schemas/` (their `review-output.schema.json` is a good template for our `delegate-result.json`)

Patterns to **not** copy:
- JSON state file — we're using SQLite for real concurrency
- `MAX_JOBS=50` hardcoded prune — we use TTL + configurable retention
- Unix-socket path sanitization — we don't need a shared daemon in v1

---

## Verification

End-to-end verification after implementation:

1. **Install flow**:
   ```bash
   npx --yes urban-subagents@latest install --host all --force
   agent-broker doctor --host all --verbose    # all green
   ```

2. **MCP smoke test**:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' | agent-broker serve-mcp
   echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | agent-broker serve-mcp
   # both return JSON-RPC responses, four tools listed
   ```

3. **Unit + integration tests**: `npm test` passes on Linux + Windows.

4. **Real host test (Claude)**:
   - `cd /tmp/urban-test && agent-broker init`
   - Start Claude: `claude`
   - Ask: "Please delegate a read-only review of this repository structure. Use whatever delegation path is available in this environment and do not do the review inline if delegation tools are available."
   - Expected: Claude uses `mcp__urban-subagents__list_agents` and then `mcp__urban-subagents__delegate`; a row appears in `agent-broker sessions list`.

5. **Real host test (Codex)**:
   - Same directory; start Codex.
   - Ask: "Please delegate a read-only review of the auth module. Use whatever delegation path is available in this environment and do not do the review inline if delegation tools are available."
   - Expected: native multi-agent APIs are unavailable, agent reads AGENTS.md guidance, calls `mcp__urban-subagents__delegate`.

6. **Cross-host session visibility**:
   - Claude session A does `delegate` → session_id captured
   - Codex session B calls `mcp__urban-subagents__list_sessions` with `scope=all`
   - Session from A appears in B's result

7. **Tool-restriction proof**:
   - Delegate to `reviewer` profile (tools: [Read, Grep, Glob])
   - Prompt: "Edit README.md to add a heading"
   - Child refuses (tool not in surface); broker returns completion with no file changes; output log shows refusal reasoning.

8. **Cancel**:
   - Long delegate running (e.g. large review); `agent-broker cancel --session <id>` from another terminal
   - Child process dies within 2s; `sessions list` shows status=`interrupted`.

9. **Uninstall** (implied by idempotent install): `agent-broker init --force --uninstall` (TBD if this command ships in v1) removes managed blocks cleanly, restoring pre-install state from `backups/`.

---

## Deferred (Post-v1)

Noted but out of scope for the first cut — add only when there's a real need:

- Shared daemon (hook-managed broker process) for cross-session real-time state
- Codex app-server adapter (for `turn/interrupt` instead of process-kill)
- Cross-runtime profiles (same `reviewer` agent usable against either Claude or Codex; v1 requires one `runtime` per profile)
- Richer profile schema (tool allowlists, sandbox mode, max_turns, structured output schemas) once real use shapes what's worth exposing
- JSON-schema-typed output via `claude -p --json-schema`
- Background/detached execution + `wait` tool
- `agent-broker sessions delete <id>` and optional opt-in TTL pruning
- Web UI for `sessions list`
- Telemetry hooks
