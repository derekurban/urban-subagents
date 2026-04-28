# Current Context

This file captures the decisions and useful findings from the exploration work that led to this project.

## Core Decision

Build an **external MCP broker** as the source of truth.

Do not make Claude-native or Codex-native subagent orchestration the canonical system boundary.

Instead:

- the broker owns the unified API
- the broker owns the session registry
- Claude Code and Codex remain the execution backends
- host-native skills/plugins/commands are optional convenience layers only

## Why This Boundary

This keeps the project from turning into a competing agent harness.

The broker should own:

- configured agent definitions
- session registry
- provider selection
- subprocess/app-server orchestration
- output normalization

The providers should continue to own:

- auth
- sandboxing
- native session/thread persistence
- model execution
- provider-specific runtime behavior

## Session Model

The design moved from a task-centric API to a session-centric API.

### Current API direction

- `list_agents`
- `list_sessions`
- `get_session`
- `delegate`
- optional `cancel`

### `delegate`

- no `session_id` -> create a fresh session
- `session_id` present -> resume the same logical session

There is no separate `followup` tool in the current direction.

There is no core blocking `wait` tool in the current direction. Delegation is async-first: `delegate` starts the work and callers poll `get_session` or `list_sessions`.

## Execution Model

### v1

- async-first
- stdio MCP server
- spawn provider child processes through broker worker jobs
- no visible `cmd.exe` windows
- persist broker session state locally

### Process behavior

For one-shot runs:

- Claude: `claude -p`
- Codex: `codex exec --json`

The delegate call returns once the worker starts. The worker exits when the provider run finishes, but the broker keeps:

- broker `session_id`
- provider session/thread handle
- metadata
- final output
- timestamps and status

This means continuity comes from **resume**, not from keeping child processes alive.

## Output Contract

Default output should be **text**.

Reason:

- simplest for the orchestrator to read
- easiest to preserve across providers
- least coordination overhead

Structured JSON/schema output should exist only when downstream automation actually needs stable fields.

## Official Documentation Grounding

These are the official references the spec is anchored to.

### Claude Code

- Overview: https://code.claude.com/docs/en/overview
- How Claude Code works: https://code.claude.com/docs/en/how-claude-code-works
- CLI reference: https://code.claude.com/docs/en/cli-reference
- Programmatic/headless mode: https://code.claude.com/docs/en/headless
- Tools reference: https://code.claude.com/docs/en/tools-reference
- Settings: https://code.claude.com/docs/en/settings
- Permission modes: https://code.claude.com/docs/en/permission-modes
- MCP: https://code.claude.com/docs/en/mcp
- Sandboxing: https://code.claude.com/docs/en/sandboxing
- Sub-agents: https://docs.anthropic.com/en/docs/claude-code/sub-agents

### Codex

- Docs home: https://developers.openai.com/codex/
- CLI overview: https://developers.openai.com/codex/cli
- CLI reference: https://developers.openai.com/codex/cli/reference
- Non-interactive mode: https://developers.openai.com/codex/noninteractive
- App server: https://developers.openai.com/codex/app-server
- Config basics: https://developers.openai.com/codex/config-basic
- Config reference: https://developers.openai.com/codex/config-reference
- Sample config: https://developers.openai.com/codex/config-sample
- MCP: https://developers.openai.com/codex/mcp
- Subagents: https://developers.openai.com/codex/subagents
- Hooks: https://developers.openai.com/codex/hooks
- Rules: https://developers.openai.com/codex/rules
- AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- Skills: https://developers.openai.com/codex/skills
- Authentication: https://developers.openai.com/codex/auth
- Agent approvals and security: https://developers.openai.com/codex/agent-approvals-security

## Important Runtime Findings

### Claude Code

Official docs support resuming headless sessions:

- `claude -p`
- `--continue`
- `--resume <session_id>`

That means one-shot execution still produces resumable state.

Official docs did not provide a clean in-band cancel primitive for headless `claude -p`.

So the broker's honest cancel behavior for headless Claude is:

- terminate the subprocess
- mark the broker session locally as interrupted/canceled

### Codex

Official docs support:

- `codex exec --json`
- `codex exec resume --last`
- `codex exec resume <SESSION_ID>`

Codex app-server also exposes:

- `thread/start`
- `thread/resume`
- `thread/fork`
- `turn/start`
- `turn/interrupt`

That means Codex has a cleaner formal interrupt path once the broker moves to app-server-backed sessions.

## Plugin Reference Findings

An installed local Claude plugin from OpenAI was inspected as a reference implementation:

- plugin root:
  [codex plugin cache](C:/Users/derek/.claude/plugins/cache/openai-codex/codex/1.0.3)

Important finding:

The Claude-to-Codex bridge in that plugin is **not primarily MCP**.

It is mostly:

- Claude plugin
- Claude slash commands
- Claude subagent
- Claude skills
- Node helper script
- Codex underneath

### Useful practices from that plugin

1. thin forwarder pattern
   - the Claude-side subagent is explicitly told to forward once and not do extra work

2. single helper entrypoint
   - one Node helper script is used instead of many ad hoc shell invocations

3. session-scoped orchestration
   - status and cancel are scoped to the current Claude session

4. explicit resume choice
   - when a resumable Codex thread exists, the wrapper can ask whether to continue or start fresh

5. separate operational commands
   - status, result, cancel, setup are separate from the main delegation flow

### Design lesson

That plugin is a good reference for a **host-native convenience layer**.

It is not the right canonical orchestration boundary for this project because it is Claude-specific.

## Architecture Recommendation

### Canonical layer

External MCP broker.

### Optional convenience layers

- Claude plugin/skill/command wrappers
- Codex rule/skill/plugin wrappers

Those wrappers should stay thin and call the broker instead of owning orchestration logic themselves.

## Suggested v1 Implementation

One executable:

- `agent-broker serve-mcp`
- `agent-broker agents list`
- `agent-broker sessions list`
- `agent-broker delegate ...`
- `agent-broker cancel ...`

Suggested internal pieces:

- config loader
- SQLite session registry
- Claude adapter
- Codex adapter
- MCP stdio server
- admin/debug CLI

## Open Questions

1. Should broker `session_id` map one-to-one to provider sessions, or can one broker session span multiple provider runs?
2. What exact fields should `list_sessions` expose by default?
3. How much provider-specific detail should be hidden versus surfaced for debugging?
4. When should the Codex adapter escalate from `codex exec` to app-server automatically?
