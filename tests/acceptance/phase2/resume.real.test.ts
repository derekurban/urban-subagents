import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  readSessionEvents,
  runBrokerCliJson,
  waitForSessionStatus,
  type Provider,
} from "../support/harness.js";

interface DelegateResult {
  session_id: string;
  status: string;
  result: string;
}

describe("phase 2 real resume acceptance", () => {
  for (const provider of ["claude", "codex"] satisfies Provider[]) {
    const providerIt =
      isAcceptanceEnabled() && getEnabledProviders().includes(provider) ? it : it.skip;

    providerIt(`reuses the ${provider} session id and records a resume event`, async () => {
      const context = createAcceptanceContext(`resume-${provider}`);
      try {
        const agent = getDefaultAgentForProvider(provider);
        await runBrokerCliJson(context, ["init", "--host", provider, "--force", "--json"]);

        const first = await runBrokerCliJson<DelegateResult>(context, [
          "delegate",
          "--agent",
          agent,
          "--prompt",
          "Reply with a short initial message."
        ]);
        await waitForSessionStatus(context, first.session_id, ["completed"], 60000);
        const second = await runBrokerCliJson<DelegateResult>(context, [
          "delegate",
          "--agent",
          agent,
          "--session",
          first.session_id,
          "--prompt",
          "Continue the same session with a short follow-up message."
        ]);

        expect(second.session_id).toBe(first.session_id);
        expect(second.status).toBe("running");
        await waitForSessionStatus(context, first.session_id, ["completed"], 60000);

        const events = readSessionEvents(context, first.session_id);
        expect(events.some((event) => event.kind === "resume")).toBe(true);
      } finally {
        context.cleanup();
      }
    });
  }
});
