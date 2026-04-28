import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  runBrokerCliJson,
  waitForSessionStatus,
  type Provider,
} from "../support/harness.js";

interface DelegateResult {
  session_id: string;
  status: "completed" | "interrupted" | "failed" | "running" | "idle";
  result: string | null;
  provider_handle: string | null;
  duration_ms: number | null;
  runtime: "claude_code" | "codex_exec";
}

function runtimeForProvider(provider: Provider): "claude_code" | "codex_exec" {
  return provider === "claude" ? "claude_code" : "codex_exec";
}

describe("phase 1 real delegate acceptance", () => {
  for (const provider of ["claude", "codex"] satisfies Provider[]) {
    const providerIt =
      isAcceptanceEnabled() && getEnabledProviders().includes(provider) ? it : it.skip;

    providerIt(`starts an async ${provider} delegate and persists the completed session`, async () => {
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

        expect(result.status).toBe("running");
        expect(result.runtime).toBe(runtimeForProvider(provider));
        expect(result.result).toBeNull();

        const session = await waitForSessionStatus(
          context,
          result.session_id,
          ["completed"],
          60000,
        );
        expect(session).not.toBeNull();
        expect(session?.status).toBe("completed");
        expect(session?.agent).toBe(agent);
        expect(session?.runtime).toBe(runtimeForProvider(provider));
        expect(String(session?.result ?? "").trim().length).toBeGreaterThan(0);
      } finally {
        context.cleanup();
      }
    });
  }
});
