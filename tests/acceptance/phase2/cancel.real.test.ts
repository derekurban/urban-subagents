import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  createProxyEnv,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  readSessionEvents,
  runBrokerCliJson,
  spawnBrokerCli,
  waitForRunningSessionWithPid,
  waitForSessionStatus,
  type Provider,
} from "../support/harness.js";

interface CancelResult {
  session_id: string;
  status: "interrupted";
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

        const delegate = spawnBrokerCli(
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

        const running = await waitForRunningSessionWithPid(context, agent, 30000);
        const cancelled = await runBrokerCliJson<CancelResult>(context, [
          "cancel",
          "--session",
          String(running.session_id),
          "--reason",
          "Acceptance cancel test"
        ]);

        expect(cancelled.status).toBe("interrupted");

        await delegate.completion;
        const session = await waitForSessionStatus(
          context,
          String(running.session_id),
          ["interrupted"],
          30000,
        );

        expect(session.status).toBe("interrupted");
        const events = readSessionEvents(context, String(running.session_id));
        expect(events.some((event) => event.kind === "cancel")).toBe(true);
      } finally {
        context.cleanup();
      }
    });
  }
});
