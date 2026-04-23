import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  runBrokerCliJson,
  type Provider,
} from "../support/harness.js";

interface DelegateResult {
  session_id: string;
}

interface SessionRow {
  session_id: string;
  parent_session_id: string | null;
  parent_runtime: "claude" | "codex" | null;
}

const acceptanceIt =
  isAcceptanceEnabled() && getEnabledProviders().length > 0 ? it : it.skip;

describe("phase 2 cross-session acceptance", () => {
  acceptanceIt("scopes current-session listings to the injected host session id", async () => {
    const context = createAcceptanceContext("cross-session");
    try {
      const provider = context.enabledProviders[0] as Provider;
      const agent = getDefaultAgentForProvider(provider);
      const runtime = provider === "claude" ? "claude" : "codex";

      await runBrokerCliJson(context, ["init", "--host", provider, "--force", "--json"]);

      const hostAEnv = {
        ...context.env,
        BROKER_HOST_SESSION_ID: "acceptance-host-a",
        BROKER_HOST_RUNTIME: runtime
      };
      const hostBEnv = {
        ...context.env,
        BROKER_HOST_SESSION_ID: "acceptance-host-b",
        BROKER_HOST_RUNTIME: runtime
      };

      const delegated = await runBrokerCliJson<DelegateResult>(
        context,
        [
          "delegate",
          "--agent",
          agent,
          "--prompt",
          "Reply with a short cross-session acceptance confirmation."
        ],
        { env: hostAEnv },
      );

      const currentA = await runBrokerCliJson<SessionRow[]>(
        context,
        ["sessions", "list", "--scope", "current", "--limit", "20"],
        { env: hostAEnv },
      );
      const currentB = await runBrokerCliJson<SessionRow[]>(
        context,
        ["sessions", "list", "--scope", "current", "--limit", "20"],
        { env: hostBEnv },
      );
      const allB = await runBrokerCliJson<SessionRow[]>(
        context,
        ["sessions", "list", "--scope", "all", "--limit", "20"],
        { env: hostBEnv },
      );

      expect(currentA.some((session) => session.session_id === delegated.session_id)).toBe(true);
      expect(currentB.some((session) => session.session_id === delegated.session_id)).toBe(false);
      expect(allB.some((session) => session.session_id === delegated.session_id)).toBe(true);
    } finally {
      context.cleanup();
    }
  });
});
