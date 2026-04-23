import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import crossSpawn from "cross-spawn";

import { buildSpawnLaunchConfig } from "../util/command-launch.js";

export interface RunCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  onSpawn?: (pid: number) => void;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface RunCommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function emitLines(buffer: { value: string }, chunk: string, cb?: (line: string) => void) {
  if (!cb) {
    buffer.value += chunk;
    return;
  }

  buffer.value += chunk;
  const parts = buffer.value.split(/\r?\n/);
  buffer.value = parts.pop() ?? "";
  for (const line of parts) {
    cb(line);
  }
}

export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const startedAt = Date.now();
  const launch = buildSpawnLaunchConfig(options.command, options.args);

  return await new Promise<RunCommandResult>((resolve, reject) => {
    const child = crossSpawn(launch.command, launch.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "pipe",
      windowsHide: true
    });
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    const stdinStream = child.stdin;

    if (!stdoutStream || !stderrStream || !stdinStream) {
      reject(new Error(`Failed to open stdio pipes for ${launch.resolvedCommand}.`));
      return;
    }

    let stdout = "";
    let stderr = "";
    const stdoutLines = { value: "" };
    const stderrLines = { value: "" };

    child.once("error", reject);

    child.once("spawn", () => {
      if (child.pid) {
        options.onSpawn?.(child.pid);
      }
    });

    stdoutStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk: string) => {
      stdout += chunk;
      emitLines(stdoutLines, chunk, options.onStdoutLine);
    });

    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk;
      emitLines(stderrLines, chunk, options.onStderrLine);
    });

    if (options.stdin !== undefined) {
      stdinStream.write(options.stdin);
    }
    stdinStream.end();

    child.once("close", (code, signal) => {
      if (stdoutLines.value) {
        options.onStdoutLine?.(stdoutLines.value);
      }
      if (stderrLines.value) {
        options.onStderrLine?.(stderrLines.value);
      }

      resolve({
        exitCode: code ?? 0,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

export async function terminatePid(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = nodeSpawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.once("close", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
}

export function createEmptyChildMcpConfig(baseDir: string, sessionId: string): string {
  fs.mkdirSync(baseDir, { recursive: true });
  const target = path.join(baseDir, `child-mcp-${sessionId}.json`);
  fs.writeFileSync(target, JSON.stringify({ mcpServers: {} }, null, 2) + "\n", "utf8");
  return target;
}

export function createOutputCaptureFile(baseDir: string, prefix: string): string {
  fs.mkdirSync(baseDir, { recursive: true });
  const target = path.join(
    baseDir,
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
  );
  fs.writeFileSync(target, "", "utf8");
  return target;
}

export function fallbackEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extra
  };
}

export function readPromptFile(target: string): string {
  return fs.readFileSync(target, "utf8");
}

export function parseJsonLines(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function readIfExists(target: string): string {
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
