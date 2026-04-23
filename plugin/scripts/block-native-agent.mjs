#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

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

const raw = await readStdin();
let subagentType = "requested";

try {
  const parsed = JSON.parse(raw);
  subagentType =
    parsed?.tool_input?.subagent_type ??
    parsed?.toolInput?.subagent_type ??
    parsed?.toolInput?.subagentType ??
    subagentType;
} catch {}

const hookLog = process.env.URBAN_SUBAGENTS_TEST_HOOK_LOG;
if (hookLog) {
  try {
    fs.appendFileSync(
      hookLog,
      JSON.stringify({
        ts: new Date().toISOString(),
        hook_event_name: "PreToolUse",
        subagent_type: subagentType
      }) + "\n",
      "utf8",
    );
  } catch {}
}

const output = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `Native Agent is disabled under urban-subagents Mode 3. Use mcp__urban-subagents__delegate with agent="${subagentType}" and prompt="<your prompt>" instead. Run mcp__urban-subagents__list_agents to see available profiles.`
  }
};

process.stdout.write(JSON.stringify(output));
