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

let stdout = "";
let stderr = "";
let finalized = false;

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
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

  await sleep(delayMs);
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
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
