import { describe, expect, it } from "vitest";

import { BrokerCore } from "../../src/broker/core.js";
import { runInit } from "../../src/install/index.js";

describe("Claude broker integration", () => {
  it("delegates through the planner profile", async () => {
    await runInit({
      cwd: process.cwd(),
      host: "all",
      force: true
    });

    const broker = new BrokerCore();
    try {
      const result = await broker.delegate({
        agent: "planner",
        prompt: "Plan the work"
      });
      expect(result.runtime).toBe("claude_code");
      expect(result.result).toContain("Claude handled");
    } finally {
      broker.close();
    }
  });
});
