import { describe, expect, it } from "vitest";

import { BrokerCore } from "../../src/broker/core.js";
import { runInit } from "../../src/install/index.js";

describe("Codex broker integration", () => {
  it("delegates through the reviewer profile", async () => {
    await runInit({
      cwd: process.cwd(),
      host: "all",
      force: true
    });

    const broker = new BrokerCore();
    try {
      const result = await broker.delegate({
        agent: "reviewer",
        prompt: "Review the code"
      });
      expect(result.runtime).toBe("codex_exec");
      expect(result.result).toContain("Codex handled");
    } finally {
      broker.close();
    }
  });
});
