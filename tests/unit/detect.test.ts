import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveBrokerLaunchConfigFor,
  withBrokerHostRuntime,
} from "../../src/install/detect.js";
import {
  buildSpawnLaunchConfig,
  resolveExecutablePath,
} from "../../src/util/command-launch.js";

describe("command launch helpers", () => {
  it("wraps Windows PowerShell shims through powershell.exe", () => {
    const target = String.raw`C:\Users\derek\AppData\Roaming\npm\codex.ps1`;
    const launch = buildSpawnLaunchConfig(target, ["--version"], "win32", () => false);

    expect(launch).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        target,
        "--version"
      ],
      resolvedCommand: target
    });
  });

  it("prefers a sibling cmd shim over the PowerShell wrapper", () => {
    const target = String.raw`C:\Users\derek\AppData\Roaming\npm\codex.ps1`;
    const sibling = String.raw`C:\Users\derek\AppData\Roaming\npm\codex.cmd`;
    const launch = buildSpawnLaunchConfig(
      target,
      ["exec", "--json"],
      "win32",
      (candidate) => candidate === target || candidate === sibling,
    );

    expect(launch).toEqual({
      command: sibling,
      args: ["exec", "--json"],
      resolvedCommand: sibling
    });
  });

  it("resolves a bare Windows command to the preferred shim", () => {
    const target = String.raw`C:\Users\derek\AppData\Roaming\npm\codex.cmd`;
    const resolved = resolveExecutablePath(
      "codex",
      "win32",
      () => true,
      () => target,
    );

    expect(resolved).toBe(target);
  });

  it("keeps Windows cmd shims as the resolved command", () => {
    const target = String.raw`C:\Users\derek\AppData\Roaming\npm\codex.cmd`;
    const launch = buildSpawnLaunchConfig(
      target,
      ["--version"],
      "win32",
      () => true,
    );

    expect(launch).toEqual({
      command: target,
      args: ["--version"],
      resolvedCommand: target
    });
  });
});

describe("resolveBrokerLaunchConfigFor", () => {
  it("rebuilds a source entrypoint launch through tsx", () => {
    const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
    const sourceEntry = path.resolve("src", "cli", "index.ts");
    const config = resolveBrokerLaunchConfigFor(
      ["node", sourceEntry, "doctor", "--verbose"],
      {},
      {
        execPath: "node",
        fileExists: (target) => target === tsxCli || target === sourceEntry
      },
    );

    expect(config).toEqual({
      command: "node",
      args: [tsxCli, sourceEntry, "serve-mcp"]
    });
  });

  it("preserves tsx source launches for serve-mcp", () => {
    const tsxCli = path.resolve("node_modules", "tsx", "dist", "cli.mjs");
    const sourceEntry = path.resolve("src", "cli", "index.ts");
    const config = resolveBrokerLaunchConfigFor(
      ["node", tsxCli, sourceEntry, "doctor", "--verbose"],
      {},
      {
        execPath: "node",
        fileExists: (target) => target === tsxCli || target === sourceEntry
      },
    );

    expect(config).toEqual({
      command: "node",
      args: [tsxCli, sourceEntry, "serve-mcp"]
    });
  });

  it("prefers explicit broker command overrides", () => {
    const config = resolveBrokerLaunchConfigFor(
      ["node", "ignored.js"],
      {
        URBAN_SUBAGENTS_BROKER_COMMAND: "custom-broker",
        URBAN_SUBAGENTS_BROKER_ARGS: JSON.stringify(["serve-mcp", "--stdio"])
      },
      {
        execPath: "node",
        fileExists: () => false
      },
    );

    expect(config).toEqual({
      command: "custom-broker",
      args: ["serve-mcp", "--stdio"]
    });
  });

  it("appends a host runtime to broker launch args", () => {
    const config = withBrokerHostRuntime(
      {
        command: "agent-broker",
        args: ["serve-mcp"]
      },
      "claude",
    );

    expect(config).toEqual({
      command: "agent-broker",
      args: ["serve-mcp", "--host-runtime", "claude"]
    });
  });
});
