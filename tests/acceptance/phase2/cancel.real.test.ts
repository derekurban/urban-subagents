import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  createProxyEnv,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  readSessionEvents,
  runBrokerCliJson,
  waitForSessionStatus,
  type Provider,
} from "../support/harness.js";

interface CancelResult {
  session_id: string;
  status: "interrupted";
}

interface DelegateResult {
  session_id: string;
  status: "running";
}

describe("phase 2 cancel acceptance", () => {
  for (const provider of ["claude", "codex"] satisfies Provider[]) {
    const providerIt =
      isAcceptanceEnabled() && getEnabledProviders().includes(provider) ? it : it.skip;

    providerIt(`interrupts an in-flight ${provider} delegate and keeps the session interrupted`, async () => {
      const context = createAcceptanceContext(`cancel-${provider}`);
      try {
        const agent = getDefaultAgentForProvider(provider);
        await runBrokerCliJson(context, ["init", "--host", provider, "--force", "--json"]);

        const delegate = await runBrokerCliJson<DelegateResult>(
          context,
          [
            "delegate",
            "--agent",
            agent,
            "--prompt",
            "Produce a longer response so the broker has time to receive a cancellation request."
          ],
          { env: createProxyEnv(context, provider, 4000) },
        );

        const cancelled = await runBrokerCliJson<CancelResult>(context, [
          "cancel",
          "--session",
          delegate.session_id,
          "--reason",
          "Acceptance cancel test"
        ]);

        expect(cancelled.status).toBe("interrupted");
        const session = await waitForSessionStatus(
          context,
          delegate.session_id,
          ["interrupted"],
          30000,
        );

        expect(session.status).toBe("interrupted");
        const events = readSessionEvents(context, delegate.session_id);
        expect(events.some((event) => event.kind === "cancel")).toBe(true);
      } finally {
        context.cleanup();
      }
    });
  }
});
