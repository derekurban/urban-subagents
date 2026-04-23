import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll } from "vitest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "urban-subagents-tests-"));
const fixtureDir = path.resolve("tests", "fixtures", "mock-provider-cli");
const mockClaude = path.join(
  fixtureDir,
  process.platform === "win32" ? "claude.cmd" : "claude",
);
const mockCodex = path.join(
  fixtureDir,
  process.platform === "win32" ? "codex.cmd" : "codex",
);
const brokerArgs = [
  path.resolve("node_modules", "tsx", "dist", "cli.mjs"),
  path.resolve("src", "cli", "index.ts"),
  "serve-mcp"
];

beforeAll(() => {
  process.env.URBAN_SUBAGENTS_HOME = path.join(tempRoot, "urban-home");
  process.env.CODEX_HOME = path.join(tempRoot, "codex-home");
  process.env.URBAN_SUBAGENTS_BROKER_COMMAND = process.execPath;
  process.env.URBAN_SUBAGENTS_BROKER_ARGS = JSON.stringify(brokerArgs);
  process.env.BROKER_CLAUDE_BIN = mockClaude;
  process.env.BROKER_CODEX_BIN = mockCodex;
  process.env.PATH = `${fixtureDir}${path.delimiter}${process.env.PATH ?? ""}`;
  fs.mkdirSync(process.env.URBAN_SUBAGENTS_HOME, { recursive: true });
  fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
});
