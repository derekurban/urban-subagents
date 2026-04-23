#!/usr/bin/env node

import process from "node:process";
import crossSpawn from "cross-spawn";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pipeStdin(target) {
  process.stdin.on("data", (chunk) => {
    target.write(chunk);
  });
  process.stdin.on("end", () => {
    target.end();
  });
}

const realBin = process.env.URBAN_SUBAGENTS_PROVIDER_REAL_BIN;
const delayMs = Number(process.env.URBAN_SUBAGENTS_PROVIDER_DELAY_MS ?? "0");

if (!realBin) {
  process.stderr.write("URBAN_SUBAGENTS_PROVIDER_REAL_BIN is required.\n");
  process.exit(1);
}

const child = crossSpawn(realBin, process.argv.slice(2), {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: process.env
});

pipeStdin(child.stdin);

let announcedSession = false;
let stdoutBuffer = "";
let stderrBuffer = "";
let lineBuffer = "";
let finalized = false;

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  lineBuffer += chunk;
  const parts = lineBuffer.split(/\r?\n/);
  lineBuffer = parts.pop() ?? "";

  for (const part of parts) {
    const line = `${part}\n`;
    if (!announcedSession && /"(session_id|thread_id)"\s*:/.test(line)) {
      announcedSession = true;
      process.stdout.write(line);
    } else {
      stdoutBuffer += line;
    }
  }
});
child.stderr.on("data", (chunk) => {
  stderrBuffer += chunk;
});

function terminateChild(signal) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch {}
}

async function finalize(code, signal) {
  if (finalized) {
    return;
  }
  finalized = true;

  if (lineBuffer) {
    if (!announcedSession && /"(session_id|thread_id)"\s*:/.test(lineBuffer)) {
      announcedSession = true;
      process.stdout.write(lineBuffer);
    } else {
      stdoutBuffer += lineBuffer;
    }
  }

  await sleep(delayMs);
  if (stdoutBuffer) {
    process.stdout.write(stdoutBuffer);
  }
  if (stderrBuffer) {
    process.stderr.write(stderrBuffer);
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
}

process.on("SIGTERM", () => {
  terminateChild("SIGTERM");
  process.exit(143);
});
process.on("SIGINT", () => {
  terminateChild("SIGINT");
  process.exit(130);
});

child.once("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});

child.once("close", (code, signal) => {
  void finalize(code, signal);
});
