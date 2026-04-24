import { afterEach, describe, expect, it } from "vitest";

import { BrokerCore } from "../../src/broker/core.js";

describe("BrokerCore", () => {
  const previousChildFlag = process.env.URBAN_SUBAGENTS_CHILD;

  afterEach(() => {
    if (previousChildFlag === undefined) {
      delete process.env.URBAN_SUBAGENTS_CHILD;
    } else {
      process.env.URBAN_SUBAGENTS_CHILD = previousChildFlag;
    }
  });

  it("rejects recursive delegation from broker-managed child agents", async () => {
    process.env.URBAN_SUBAGENTS_CHILD = "1";
    const broker = new BrokerCore(process.cwd());

    await expect(
      broker.delegate({
        agent: "reviewer",
        prompt: "Try to delegate again"
      }),
    ).rejects.toThrow("Recursive delegation is disabled");

    broker.close();
  });
});
