import { Command } from "commander";

import { BrokerCore } from "../broker/core.js";
import { runDoctor } from "../doctor/checks.js";
import { renderDoctorReport, summarizeDoctorResults } from "../doctor/report.js";
import { runBootstrapInstall } from "../install/bootstrap.js";
import { serveMcp } from "../mcp/server.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const program = new Command();
  program
    .name("agent-broker")
    .description("Cross-provider sub-agent broker for Claude Code and Codex.")
    .showHelpAfterError();

  program
    .command("serve-mcp")
    .description("Run the stdio MCP broker server.")
    .option("--host-runtime <hostRuntime>", "Host runtime: claude or codex")
    .action(async (options: { hostRuntime?: string }) => {
      const hostRuntime =
        options.hostRuntime === "claude" || options.hostRuntime === "codex"
          ? options.hostRuntime
          : undefined;
      await serveMcp(process.cwd(), hostRuntime ?? null);
    });

  program
    .command("install")
    .description("Bootstrap a persistent global install, then run init and doctor.")
    .option("--host <host>", "Target host: all, claude, or codex", "all")
    .option("--force", "Apply changes without confirmation")
    .option("--skip-doctor", "Skip the post-install doctor run")
    .option("--package-spec <packageSpec>", "Install from this npm/git/tarball spec instead of the default source")
    .option("--json", "Emit machine-readable JSON output")
    .action(async (options: {
      host: "all" | "claude" | "codex";
      force?: boolean;
      skipDoctor?: boolean;
      packageSpec?: string;
      json?: boolean;
    }) => {
      const outcome = await runBootstrapInstall(options);
      if (options.json) {
        printJson(outcome.result);
      }
      if (outcome.exitCode !== 0) {
        process.exitCode = outcome.exitCode;
      }
    });

  program
    .command("init")
    .description("Install or update broker configuration for Claude and Codex.")
    .option("--host <host>", "Target host: all, claude, or codex", "all")
    .option("--dry-run", "Preview the writes without applying them")
    .option("--force", "Apply changes without confirmation")
    .option("--json", "Emit machine-readable JSON output")
    .action(async (options: { host: "all" | "claude" | "codex"; dryRun?: boolean; force?: boolean; json?: boolean }) => {
      const broker = new BrokerCore();
      try {
        const result = await broker.init(options.host, options.dryRun, options.force);
        if (options.json) {
          if (options.dryRun) {
            printJson({
              dry_run: true,
              preview: result
            });
          } else {
            printJson({
              dry_run: false,
              written_files: result
            });
          }
        } else if (options.dryRun) {
          console.log(result.join("\n\n"));
        } else {
          console.log(`Wrote ${result.length} file(s):`);
          for (const target of result) {
            console.log(target);
          }
        }
      } finally {
        broker.close();
      }
    });

  program
    .command("doctor")
    .description("Validate broker installation and runtime health.")
    .option("--host <host>", "Target host: all, claude, or codex", "all")
    .option("--verbose", "Run provider smoke tests")
    .option("--fix", "Re-apply managed config when drift is detected")
    .option("--json", "Emit machine-readable JSON output")
    .action(async (options: { host: "all" | "claude" | "codex"; verbose?: boolean; fix?: boolean; json?: boolean }) => {
      const results = await runDoctor(options);
      if (options.json) {
        printJson({
          results,
          summary: summarizeDoctorResults(results)
        });
      } else {
        console.log(renderDoctorReport(results));
      }
      if (results.some((result) => result.status === "fail")) {
        process.exitCode = 1;
      }
    });

  const agents = program.command("agents").description("List agent profiles.");
  agents
    .command("list")
    .action(() => {
      const broker = new BrokerCore();
      try {
        printJson(broker.listAgents());
      } finally {
        broker.close();
      }
    });

  const sessions = program.command("sessions").description("Inspect broker sessions.");
  sessions
    .command("list")
    .option("--scope <scope>", "current or all", "current")
    .option("--agent <agent>", "Filter by agent name")
    .option("--status <status>", "Filter by session status")
    .option("--limit <limit>", "Result limit", (value) => Number.parseInt(value, 10), 50)
    .action((options: { scope?: "current" | "all"; agent?: string; status?: string; limit?: number }) => {
      const broker = new BrokerCore();
      try {
        const query: {
          scope?: "current" | "all";
          agent?: string;
          status?: never;
          limit?: number;
        } = {};
        if (options.scope) {
          query.scope = options.scope;
        }
        if (options.agent) {
          query.agent = options.agent;
        }
        if (options.status) {
          query.status = options.status as never;
        }
        if (options.limit !== undefined) {
          query.limit = options.limit;
        }

        printJson(
          broker.listSessions(query),
        );
      } finally {
        broker.close();
      }
    });
  sessions
    .command("get")
    .requiredOption("--session <sessionId>", "Session identifier")
    .action((options: { session: string }) => {
      const broker = new BrokerCore();
      try {
        printJson(broker.getSession(options.session));
      } finally {
        broker.close();
      }
    });

  program
    .command("delegate")
    .requiredOption("--agent <agent>", "Agent profile name")
    .requiredOption("--prompt <prompt>", "Prompt text")
    .option("--session <sessionId>", "Resume an existing session")
    .option("--cwd <cwd>", "Working directory override")
    .action(async (options: { agent: string; prompt: string; session?: string; cwd?: string }) => {
      const broker = new BrokerCore();
      try {
        const request: {
          agent: string;
          prompt: string;
          session_id?: string;
          cwd?: string;
        } = {
          agent: options.agent,
          prompt: options.prompt
        };
        if (options.session) {
          request.session_id = options.session;
        }
        if (options.cwd) {
          request.cwd = options.cwd;
        }
        const result = await broker.delegate({
          ...request
        });
        printJson(result);
      } finally {
        broker.close();
      }
    });

  const worker = program.command("worker", { hidden: true }).description("Internal broker worker commands.");
  worker
    .command("run")
    .requiredOption("--job <jobPath>", "Delegate worker job file")
    .action(async (options: { job: string }) => {
      const broker = new BrokerCore();
      try {
        await broker.runDelegateWorker(options.job);
      } finally {
        broker.close();
      }
    });

  program
    .command("cancel")
    .requiredOption("--session <sessionId>", "Session identifier")
    .option("--reason <reason>", "Cancellation reason")
    .action(async (options: { session: string; reason?: string }) => {
      const broker = new BrokerCore();
      try {
        const result = await broker.cancel(options.session, options.reason);
        printJson(result);
      } finally {
        broker.close();
      }
    });

  program
    .command("reset")
    .option("--force", "Confirm reset")
    .action((options: { force?: boolean }) => {
      const broker = new BrokerCore();
      try {
        broker.reset(Boolean(options.force));
        console.log("Broker state reset.");
      } finally {
        broker.close();
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
