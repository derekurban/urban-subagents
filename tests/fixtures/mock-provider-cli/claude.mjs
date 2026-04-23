#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import process from "node:process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const args = process.argv.slice(2);

if (args.includes("--version")) {
  process.stdout.write("2.1.117.0\n");
  process.exit(0);
}

if (args.includes("--help")) {
  process.stdout.write("--session-id --resume --output-format --bare --strict-mcp-config --permission-mode\n");
  process.exit(0);
}

let prompt = "";
let sessionId = randomUUID();

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "-p") {
    prompt = args[index + 1] ?? "";
  }
  if (args[index] === "--session-id" || args[index] === "--resume") {
    sessionId = args[index + 1] ?? sessionId;
  }
}

if (process.env.MOCK_PROVIDER_SLEEP_MS) {
  await sleep(Number(process.env.MOCK_PROVIDER_SLEEP_MS));
}

if (prompt.includes("FAIL") || process.env.MOCK_PROVIDER_FAIL === "1") {
  process.stderr.write("mock claude failure\n");
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({
    session_id: sessionId,
    result: `Claude handled: ${prompt}`
  })}\n`,
);
