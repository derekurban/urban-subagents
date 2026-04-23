import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  readSession,
  runBrokerCliJson,
  type Provider,
} from "../support/harness.js";

interface DelegateResult {
  session_id: string;
  status: "completed" | "interrupted" | "failed" | "running" | "idle";
  result: string;
  provider_handle: string;
  duration_ms: number;
  runtime: "claude_code" | "codex_exec";
}

function runtimeForProvider(provider: Provider): "claude_code" | "codex_exec" {
  return provider === "claude" ? "claude_code" : "codex_exec";
}

describe("phase 1 real delegate acceptance", () => {
  for (const provider of ["claude", "codex"] satisfies Provider[]) {
    const providerIt =
      isAcceptanceEnabled() && getEnabledProviders().includes(provider) ? it : it.skip;

    providerIt(`delegates through ${provider} and persists the completed session`, async () => {
      const context = createAcceptanceContext(`delegate-${provider}`);
      try {
        const agent = getDefaultAgentForProvider(provider);
        await runBrokerCliJson(context, ["init", "--host", provider, "--force", "--json"]);

        const result = await runBrokerCliJson<DelegateResult>(context, [
          "delegate",
          "--agent",
          agent,
          "--prompt",
          "Reply with a short acceptance-test confirmation."
        ]);

        expect(result.status).toBe("completed");
        expect(result.runtime).toBe(runtimeForProvider(provider));
        expect(result.result.trim().length).toBeGreaterThan(0);

        const session = readSession(context, result.session_id);
        expect(session).not.toBeNull();
        expect(session?.status).toBe("completed");
        expect(session?.agent).toBe(agent);
        expect(session?.runtime).toBe(runtimeForProvider(provider));
      } finally {
        context.cleanup();
      }
    });
  }
});
