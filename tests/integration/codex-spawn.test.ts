import { describe, expect, it } from "vitest";

import { BrokerCore } from "../../src/broker/core.js";
import { runInit } from "../../src/install/index.js";

async function waitForCompletedSession(broker: BrokerCore, sessionId: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const session = broker.getSession(sessionId);
    if (session.status === "completed") {
      return session;
    }
    if (session.status === "failed" || session.status === "interrupted") {
      throw new Error(`Session ended with ${session.status}: ${session.error ?? ""}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for session ${sessionId}.`);
}

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
      expect(result.status).toBe("running");

      const completed = await waitForCompletedSession(broker, result.session_id);
      expect(completed.result).toContain("Codex handled");
    } finally {
      broker.close();
    }
  });
});
