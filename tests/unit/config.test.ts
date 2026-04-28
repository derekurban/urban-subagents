import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseBrokerConfig } from "../../src/broker/config.js";

describe("parseBrokerConfig", () => {
  it("fills broker defaults", () => {
    const config = parseBrokerConfig(
      `
agents:
  reviewer:
    description: Read-only review
    runtime: codex_exec
    model: gpt-5.4
    reasoning_effort: xhigh
    prompt_file: prompts/reviewer.md
`,
      path.resolve("config.yaml"),
      "user",
    );

    expect(config.version).toBe("0.1");
    expect(config.broker.execution_mode).toBe("async");
    expect(config.broker.default_output.format).toBe("text");
    expect(config.agents.reviewer?.runtime).toBe("codex_exec");
    expect(config.agents.reviewer?.reasoning_effort).toBe("xhigh");
  });
});
