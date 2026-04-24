# Acceptance Testing

`IMPLEMENTATION_PLAN.md` remains the canonical implementation spec. This document covers the real acceptance harness and the manual host checks that sit on top of the fast mock-backed suite.

## Automated Suites

- `npm test`
  - Fast default suite.
  - Uses the mock provider CLIs under `tests/fixtures/mock-provider-cli/`.
- `npm run test:acceptance`
  - Opt-in real acceptance suite.
  - Runs only when `RUN_REAL_ACCEPTANCE=1` is set by the script.
  - Auto-detects installed `claude` / `codex` CLIs unless provider-specific env flags are set.
- `npm run test:acceptance:claude`
  - Runs only the Claude-backed acceptance tests.
- `npm run test:acceptance:codex`
  - Runs only the Codex-backed acceptance tests.

## Real Acceptance Env

- `URBAN_SUBAGENTS_REAL_CLAUDE_BIN`
  - Optional override for the real Claude binary.
- `URBAN_SUBAGENTS_REAL_CODEX_BIN`
  - Optional override for the real Codex binary.
- `RUN_REAL_CLAUDE=1`
  - Restrict acceptance execution to Claude tests.
- `RUN_REAL_CODEX=1`
  - Restrict acceptance execution to Codex tests.
- `URBAN_SUBAGENTS_PROVIDER_DELAY_MS`
  - Used by the acceptance-only provider proxy wrappers during cancel tests.
- `URBAN_SUBAGENTS_TEST_HOOK_LOG`
  - When set, `plugin/scripts/block-native-agent.mjs` appends JSONL hook evidence for manual Claude validation.

The acceptance harness always creates its own temporary workspace, `URBAN_SUBAGENTS_HOME`, and `CODEX_HOME`. It does not write into the operator's real broker state or real Codex home.
The suite probes each provider before running and skips providers that are installed but not currently runnable, for example a Claude CLI that is present but not logged in.
For Claude, the acceptance harness sets `BROKER_CLAUDE_MODE=oauth-acceptance`, which drops `--bare` for test delegates and instead uses a narrower OAuth-compatible path with `--disable-slash-commands` and `--setting-sources local`.

## Automated Acceptance Coverage

Phase 1:
- `tests/acceptance/phase1/init.real.test.ts`
  - Exercises `agent-broker init --json` in an isolated scratch environment.
- `tests/acceptance/phase1/doctor.real.test.ts`
  - Exercises `agent-broker doctor --json --verbose` after a real install.
- `tests/acceptance/phase1/delegate.real.test.ts`
  - Delegates through the real Claude and/or Codex CLIs and asserts persisted session rows.
- `tests/acceptance/phase1/mcp.real.test.ts`
  - Starts `serve-mcp`, lists tools over stdio MCP, and performs one real delegate round-trip.

Phase 2:
- `tests/acceptance/phase2/resume.real.test.ts`
  - Reuses an existing `session_id` and asserts a `resume` event was persisted.
- `tests/acceptance/phase2/cross-session.real.test.ts`
  - Injects explicit `BROKER_HOST_SESSION_ID` / `BROKER_HOST_RUNTIME` values and verifies `scope=current` versus `scope=all`.
- `tests/acceptance/phase2/cancel.real.test.ts`
  - Uses acceptance-only delay proxies to make cancel deterministic against real provider binaries.
- `tests/acceptance/phase2/tool-restriction.real.test.ts`
  - Verifies the default read-only profiles do not mutate workspace files.

## Manual Host Testing

Manual host testing is intentionally different from the automated acceptance harness:

- Automated acceptance uses isolated temp homes.
- Manual host testing uses your real PATH-installed `claude` and `codex` CLIs and your real base host configs.
- The scratch directory is mainly for broker workspace operations; Claude itself is now configured through user-scoped files like `~/.claude/CLAUDE.md`, `~/.claude/settings.json`, and `~/.claude.json`.
- The only recommended manual override is `BROKER_CLAUDE_MODE=oauth-acceptance` so broker-spawned Claude delegates work with OAuth-backed local installs.

Current manual expectations:

- Claude:
  - Preferred success path: a natural-language delegation request causes Claude to use `mcp__urban-subagents__list_agents` and then `mcp__urban-subagents__delegate`.
  - The managed user `~/.claude.json` should register the broker under `mcpServers.urban-subagents`.
  - Native `Agent` remains disabled, but hook-log evidence is secondary rather than the primary success signal.
  - Known failure signal to capture verbatim: Claude says delegation is unavailable instead of using the broker MCP tools.
- Codex:
  - Preferred success path: a natural-language delegation request causes Codex to discover the broker MCP toolset and complete a broker `delegate` call instead of using native multi-agent APIs.
  - Host-created broker sessions should now record a non-null `parent_session_id` and `parent_runtime`.
  - Known failure signal to capture verbatim: Codex discovers `urban-subagents.list_agents` but never completes a `delegate` call.

## Current Limits

- The real automated acceptance suite is local-only and opt-in. It is not part of the default CI gate yet.
- Full host-interactive automation is still manual or semi-manual. The automated suite validates broker behavior against the real CLIs, not full TTY model steering.

## Manual Runbook

- [MANUAL_HOST_TEST_REPORT.md](/D:/Working/urban-subagents/tests/MANUAL_HOST_TEST_REPORT.md)
  - Single staging document for copy/paste PowerShell checks, interactive host validation, and recorded findings.
