#!/usr/bin/env node

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import process from "node:process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("codex-cli 0.0.0-mock\n");
  process.exit(0);
}

if (args.includes("--help")) {
  process.stdout.write("--profile --json exec resume\n");
  process.exit(0);
}

if (args[0] === "mcp" && args[1] === "list" && args.includes("--json")) {
  process.stdout.write("[]\n");
  process.exit(0);
}

let outputFile = null;
let sessionId = randomUUID();
let promptFromArg = null;

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "-o") {
    outputFile = args[index + 1];
  }
}

if (args[0] === "exec" && args[1] === "resume") {
  sessionId = args.find((arg, index) => index > 1 && !arg.startsWith("-") && arg !== "-") ?? sessionId;
  promptFromArg = args.at(-1) === "-" ? await readStdin() : (args.at(-1) ?? "");
} else if (args[0] === "exec") {
  promptFromArg = args.at(-1) === "-" ? await readStdin() : (args.at(-1) ?? "");
}

if (process.env.MOCK_PROVIDER_SLEEP_MS) {
  await sleep(Number(process.env.MOCK_PROVIDER_SLEEP_MS));
}

if ((promptFromArg ?? "").includes("FAIL") || process.env.MOCK_PROVIDER_FAIL === "1") {
  process.stderr.write("mock codex failure\n");
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: sessionId })}\n`);
process.stdout.write(`${JSON.stringify({ type: "message.completed", thread_id: sessionId })}\n`);

if (outputFile) {
  fs.writeFileSync(outputFile, `Codex handled: ${promptFromArg ?? ""}\n`, "utf8");
}
