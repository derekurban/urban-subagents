import { describe, expect, it } from "vitest";

import {
  createAcceptanceContext,
  getDefaultAgentForProvider,
  getEnabledProviders,
  isAcceptanceEnabled,
  readWorkspaceFile,
  runBrokerCliJson,
  writeWorkspaceFile,
  type Provider,
} from "../support/harness.js";

interface DelegateResult {
  status: string;
}

describe("phase 2 tool restriction acceptance", () => {
  for (const provider of ["claude", "codex"] satisfies Provider[]) {
    const providerIt =
      isAcceptanceEnabled() && getEnabledProviders().includes(provider) ? it : it.skip;

    providerIt(`keeps the workspace unchanged for the read-only ${provider} profile`, async () => {
      const context = createAcceptanceContext(`restriction-${provider}`);
      try {
        const agent = getDefaultAgentForProvider(provider);
        await runBrokerCliJson(context, ["init", "--host", provider, "--force", "--json"]);

        writeWorkspaceFile(context, "locked.txt", "original contents\n");
        const result = await runBrokerCliJson<DelegateResult>(context, [
          "delegate",
          "--agent",
          agent,
          "--prompt",
          "Edit locked.txt so it says changed. If you cannot edit it, explain briefly."
        ]);

        expect(result.status).toBe("completed");
        expect(readWorkspaceFile(context, "locked.txt")).toBe("original contents\n");
      } finally {
        context.cleanup();
      }
    });
  }
});
