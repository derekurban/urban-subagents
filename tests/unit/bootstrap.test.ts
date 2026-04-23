import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBrokerCommandOverrideEnv,
  buildPackageSpec,
  getGlobalBinDir,
  getGlobalPackageRoot,
  getInstalledBrokerVersion,
  readCurrentPackageMetadata,
  resolveBootstrapPackageSpec,
  resolveInstalledBrokerRuntime,
} from "../../src/install/bootstrap.js";

describe("bootstrap helpers", () => {
  it("reads package metadata from package.json", () => {
    const metadata = readCurrentPackageMetadata(
      "/virtual/package",
      () => JSON.stringify({
        name: "urban-subagents",
        version: "0.1.0"
      }),
    );

    expect(metadata).toEqual({
      name: "urban-subagents",
      version: "0.1.0"
    });
  });

  it("builds an npm package spec", () => {
    expect(
      buildPackageSpec({
        name: "urban-subagents",
        version: "1.2.3"
      }),
    ).toBe("urban-subagents@1.2.3");
  });

  it("falls back to the registry package spec when no bootstrap source is provided", () => {
    expect(
      resolveBootstrapPackageSpec({
        name: "urban-subagents",
        version: "1.2.3"
      }),
    ).toBe("urban-subagents@1.2.3");
  });

  it("prefers an explicit install source spec", () => {
    expect(
      resolveBootstrapPackageSpec(
        {
          name: "urban-subagents",
          version: "1.2.3"
        },
        "github:derek/urban-subagents",
      ),
    ).toBe("github:derek/urban-subagents");
  });

  it("reuses npm_config_package for github and tarball installs", () => {
    expect(
      resolveBootstrapPackageSpec(
        {
          name: "urban-subagents",
          version: "1.2.3"
        },
        undefined,
        {
          npm_config_package: "https://github.com/derek/urban-subagents/releases/download/v1.2.3/urban-subagents-1.2.3.tgz"
        },
      ),
    ).toBe(
      "https://github.com/derek/urban-subagents/releases/download/v1.2.3/urban-subagents-1.2.3.tgz",
    );
  });

  it("normalizes local folder specs against npm_config_local_prefix", () => {
    expect(
      resolveBootstrapPackageSpec(
        {
          name: "urban-subagents",
          version: "1.2.3"
        },
        undefined,
        {
          npm_config_package: ".\\release\\urban-subagents-1.2.3.tgz",
          npm_config_local_prefix: String.raw`D:\Downloads`
        },
      ),
    ).toBe(path.resolve(String.raw`D:\Downloads`, ".\\release\\urban-subagents-1.2.3.tgz"));
  });

  it("resolves a package inside the npm global root", () => {
    expect(
      getGlobalPackageRoot("/global/node_modules", "urban-subagents"),
    ).toBe(path.join("/global/node_modules", "urban-subagents"));
  });

  it("uses the expected global bin directory for each platform", () => {
    expect(getGlobalBinDir("/usr/local", "linux")).toBe(path.join("/usr/local", "bin"));
    expect(getGlobalBinDir(String.raw`C:\Users\derek\AppData\Roaming\npm`, "win32")).toBe(
      String.raw`C:\Users\derek\AppData\Roaming\npm`,
    );
  });

  it("prefers the stable global PATH launcher when it matches the installed shim", () => {
    const prefix = String.raw`C:\Users\derek\AppData\Roaming\npm`;
    const globalRoot = path.join(prefix, "node_modules");
    const cmdShim = path.join(prefix, "agent-broker.cmd");
    const entrypoint = path.join(globalRoot, "urban-subagents", "dist", "cli", "index.js");

    const runtime = resolveInstalledBrokerRuntime(
      "urban-subagents",
      "0.1.0",
      prefix,
      globalRoot,
      "win32",
      (target) => target === cmdShim || target === entrypoint,
      () => cmdShim,
      "node",
    );

    expect(runtime).toEqual({
      packageRoot: path.join(globalRoot, "urban-subagents"),
      version: "0.1.0",
      launcherMode: "path",
      command: "agent-broker",
      argsPrefix: [],
      hostLaunch: {
        command: "agent-broker",
        args: ["serve-mcp"]
      }
    });
  });

  it("falls back to an absolute node launcher when PATH does not expose the global binary", () => {
    const globalRoot = "/global/node_modules";
    const entrypoint = path.join(globalRoot, "urban-subagents", "dist", "cli", "index.js");

    const runtime = resolveInstalledBrokerRuntime(
      "urban-subagents",
      "0.1.0",
      "/global",
      globalRoot,
      "linux",
      (target) => target === entrypoint,
      () => null,
      "/usr/bin/node",
    );

    expect(runtime).toEqual({
      packageRoot: path.join(globalRoot, "urban-subagents"),
      version: "0.1.0",
      launcherMode: "absolute",
      command: "/usr/bin/node",
      argsPrefix: [entrypoint],
      hostLaunch: {
        command: "/usr/bin/node",
        args: [entrypoint, "serve-mcp"]
      }
    });
  });

  it("reads the installed broker version from the global package root", () => {
    const packageRoot = path.join("/global/node_modules", "urban-subagents");
    const packageJson = path.join(packageRoot, "package.json");

    expect(
      getInstalledBrokerVersion(
        packageRoot,
        (target) => target === packageJson,
        () => JSON.stringify({ version: "9.9.9" }),
      ),
    ).toBe("9.9.9");
  });

  it("builds broker command override env vars for downstream init and doctor", () => {
    const env = buildBrokerCommandOverrideEnv(
      {
        command: "agent-broker",
        args: ["serve-mcp", "--host-runtime", "claude"]
      },
      {
        PATH: "/usr/bin"
      },
    );

    expect(env).toMatchObject({
      PATH: "/usr/bin",
      URBAN_SUBAGENTS_BROKER_COMMAND: "agent-broker",
      URBAN_SUBAGENTS_BROKER_ARGS: JSON.stringify(["serve-mcp", "--host-runtime", "claude"])
    });
  });
});
