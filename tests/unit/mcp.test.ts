import { describe, expect, it } from "vitest";

import { resolveMcpBrokerEnvironment } from "../../src/mcp/server.js";

describe("resolveMcpBrokerEnvironment", () => {
  it("creates a synthetic host session for host-scoped MCP servers", () => {
    const env = resolveMcpBrokerEnvironment("claude");

    expect(env.hostRuntime).toBe("claude");
    expect(env.hostSessionId).toMatch(/^host-claude-/);
  });

  it("preserves explicit host session metadata from the environment", () => {
    process.env.BROKER_HOST_SESSION_ID = "host-from-env";
    process.env.BROKER_HOST_RUNTIME = "codex";

    try {
      const env = resolveMcpBrokerEnvironment("claude");
      expect(env).toEqual({
        hostSessionId: "host-from-env",
        hostRuntime: "claude"
      });
    } finally {
      delete process.env.BROKER_HOST_SESSION_ID;
      delete process.env.BROKER_HOST_RUNTIME;
    }
  });
});
