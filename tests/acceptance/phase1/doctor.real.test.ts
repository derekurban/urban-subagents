import { describe, expect, it } from "vitest";

import {
  acceptanceHostForProviders,
  createAcceptanceContext,
  getEnabledProviders,
  isAcceptanceEnabled,
  runBrokerCliJson,
} from "../support/harness.js";

interface DoctorResultRow {
  id: string;
  title: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface DoctorJsonResult {
  results: DoctorResultRow[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
}

const acceptanceIt =
  isAcceptanceEnabled() && getEnabledProviders().length > 0 ? it : it.skip;

describe("phase 1 real doctor acceptance", () => {
  acceptanceIt("runs doctor against the isolated real-cli install", async () => {
    const context = createAcceptanceContext("doctor");
    try {
      const host = acceptanceHostForProviders(context.enabledProviders);
      await runBrokerCliJson(context, ["init", "--host", host, "--force", "--json"]);

      const doctor = await runBrokerCliJson<DoctorJsonResult>(context, [
        "doctor",
        "--host",
        host,
        "--verbose",
        "--json"
      ]);

      expect(doctor.summary.fail).toBe(0);
      expect(doctor.results.some((result) => result.id === "binaries")).toBe(true);
      if (host === "all" || host === "claude") {
        expect(doctor.results.some((result) => result.id === "claude-mcp")).toBe(true);
      }
      expect(doctor.results.some((result) => result.id === "mcp")).toBe(true);
      expect(doctor.results.some((result) => result.id === "state")).toBe(true);
      expect(doctor.results.some((result) => result.id === "orphans")).toBe(true);
    } finally {
      context.cleanup();
    }
  });
});
