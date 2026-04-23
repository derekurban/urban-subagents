import fs from "node:fs";
import path from "node:path";

import crossSpawn from "cross-spawn";

import type { BrokerLaunchConfig } from "./detect.js";
import { buildSpawnLaunchConfig, resolveExecutablePath } from "../util/command-launch.js";
import { getPackageRoot } from "../util/paths.js";

export interface BootstrapInstallOptions {
  cwd?: string;
  host?: "all" | "claude" | "codex";
  force?: boolean;
  skipDoctor?: boolean;
  json?: boolean;
  packageSpec?: string;
}

export interface PackageMetadata {
  name: string;
  version: string;
}

export interface InstalledBrokerRuntime {
  packageRoot: string;
  version: string;
  launcherMode: "path" | "absolute";
  command: string;
  argsPrefix: string[];
  hostLaunch: BrokerLaunchConfig;
}

export interface BootstrapInstallResult {
  package: PackageMetadata;
  global_install: {
    action: "installed" | "reused";
    package_spec: string;
    package_root: string;
    version: string;
    launcher_mode: "path" | "absolute";
    host_launch: BrokerLaunchConfig;
  };
  init: unknown;
  doctor?: unknown;
}

export interface BootstrapInstallOutcome {
  result: BootstrapInstallResult;
  exitCode: number;
}

interface SpawnTextResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function spawnCapture(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): SpawnTextResult {
  const launch = buildSpawnLaunchConfig(command, args);
  const result = crossSpawn.sync(launch.command, launch.args, {
    encoding: "utf8",
    env,
    windowsHide: true
  });

  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    ...(result.error
      ? {
          error: result.error
        }
      : {})
  };
}

function spawnInherited(command: string, args: readonly string[], env?: NodeJS.ProcessEnv): number {
  const launch = buildSpawnLaunchConfig(command, args);
  const result = crossSpawn.sync(launch.command, launch.args, {
    env,
    stdio: "inherit",
    windowsHide: true
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function extractJsonResult(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  return JSON.parse(trimmed) as unknown;
}

export function readCurrentPackageMetadata(
  packageRoot = getPackageRoot(),
  readFile: (target: string, encoding: BufferEncoding) => string = (target, encoding) =>
    fs.readFileSync(target, encoding),
): PackageMetadata {
  const packageJson = JSON.parse(
    readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as { name?: string; version?: string };
  const name = packageJson.name?.trim();
  const version = packageJson.version?.trim();

  if (!name || !version) {
    throw new Error(`Package metadata is missing name/version at ${path.join(packageRoot, "package.json")}.`);
  }

  return { name, version };
}

export function buildPackageSpec(metadata: PackageMetadata): string {
  return `${metadata.name}@${metadata.version}`;
}

function isPathSpec(spec: string): boolean {
  return (
    spec.startsWith(".") ||
    path.isAbsolute(spec) ||
    /^[A-Za-z]:[\\/]/.test(spec)
  );
}

function isUrlLikeSpec(spec: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(spec);
}

function isRegistryLikePackageSpec(spec: string, packageName: string): boolean {
  return spec === packageName || spec.startsWith(`${packageName}@`);
}

export function resolveBootstrapPackageSpec(
  metadata: PackageMetadata,
  explicitSpec?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const sourceSpec = explicitSpec?.trim()
    || env.URBAN_SUBAGENTS_INSTALL_SPEC?.trim()
    || env.npm_config_package?.trim()
    || env.npm_package_resolved?.trim();
  if (!sourceSpec) {
    return buildPackageSpec(metadata);
  }

  const localPrefix = env.npm_config_local_prefix?.trim() || process.cwd();
  if (isPathSpec(sourceSpec)) {
    return path.resolve(localPrefix, sourceSpec);
  }

  return sourceSpec;
}

export function getGlobalPackageRoot(globalRoot: string, packageName: string): string {
  const segments = packageName.split("/");
  return path.join(globalRoot, ...segments);
}

export function getGlobalBinDir(
  globalPrefix: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? globalPrefix : path.join(globalPrefix, "bin");
}

export function resolveInstalledBrokerRuntime(
  packageName: string,
  version: string,
  globalPrefix: string,
  globalRoot: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (target: string) => boolean = fs.existsSync,
  resolveOnPath: (command: string, platform: NodeJS.Platform) => string | null = resolveExecutablePath,
  execPath = process.execPath,
): InstalledBrokerRuntime {
  const packageRoot = getGlobalPackageRoot(globalRoot, packageName);
  const entrypoint = path.join(packageRoot, "dist", "cli", "index.js");
  if (!fileExists(entrypoint)) {
    throw new Error(`Installed broker entrypoint was not found at ${entrypoint}.`);
  }

  const binDir = getGlobalBinDir(globalPrefix, platform);
  const binBase = path.join(binDir, "agent-broker");
  const preferredPathCandidate =
    platform === "win32"
      ? [".cmd", ".bat", ".ps1", ".exe"]
          .map((extension) => `${binBase}${extension}`)
          .find((candidate) => fileExists(candidate)) ?? null
      : (fileExists(binBase) ? binBase : null);

  const pathResolved = resolveOnPath("agent-broker", platform);
  if (pathResolved && preferredPathCandidate && pathResolved === preferredPathCandidate) {
    return {
      packageRoot,
      version,
      launcherMode: "path",
      command: "agent-broker",
      argsPrefix: [],
      hostLaunch: {
        command: "agent-broker",
        args: ["serve-mcp"]
      }
    };
  }

  return {
    packageRoot,
    version,
    launcherMode: "absolute",
    command: execPath,
    argsPrefix: [entrypoint],
    hostLaunch: {
      command: execPath,
      args: [entrypoint, "serve-mcp"]
    }
  };
}

export function buildBrokerCommandOverrideEnv(
  launch: BrokerLaunchConfig,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    URBAN_SUBAGENTS_BROKER_COMMAND: launch.command,
    URBAN_SUBAGENTS_BROKER_ARGS: JSON.stringify(launch.args)
  };
}

export function getInstalledBrokerVersion(
  packageRoot: string,
  fileExists: (target: string) => boolean = fs.existsSync,
  readFile: (target: string, encoding: BufferEncoding) => string = (target, encoding) =>
    fs.readFileSync(target, encoding),
): string | null {
  const packageJsonPath = path.join(packageRoot, "package.json");
  if (!fileExists(packageJsonPath)) {
    return null;
  }

  const packageJson = JSON.parse(readFile(packageJsonPath, "utf8")) as { version?: string };
  return packageJson.version?.trim() || null;
}

function getGlobalNpmPaths(): { globalRoot: string; globalPrefix: string } {
  const rootResult = spawnCapture("npm", ["root", "--global"]);
  if (rootResult.error || rootResult.status !== 0) {
    throw new Error(rootResult.stderr.trim() || rootResult.stdout.trim() || "Failed to resolve npm global root.");
  }

  const prefixResult = spawnCapture("npm", ["prefix", "--global"]);
  if (prefixResult.error || prefixResult.status !== 0) {
    throw new Error(prefixResult.stderr.trim() || prefixResult.stdout.trim() || "Failed to resolve npm global prefix.");
  }

  return {
    globalRoot: rootResult.stdout.trim(),
    globalPrefix: prefixResult.stdout.trim()
  };
}

function runInstalledBrokerJson(
  runtime: InstalledBrokerRuntime,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { output: unknown; exitCode: number } {
  const result = spawnCapture(runtime.command, [...runtime.argsPrefix, ...args], env);
  if (result.error) {
    throw result.error;
  }

  const output = extractJsonResult(result.stdout);
  return {
    output,
    exitCode: result.status ?? 1
  };
}

function runInstalledBrokerHuman(
  runtime: InstalledBrokerRuntime,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): number {
  return spawnInherited(runtime.command, [...runtime.argsPrefix, ...args], env);
}

export async function runBootstrapInstall(options: BootstrapInstallOptions = {}): Promise<BootstrapInstallOutcome> {
  const host = options.host ?? "all";
  if (options.json && !options.force) {
    throw new Error("`agent-broker install --json` requires `--force`.");
  }

  const metadata = readCurrentPackageMetadata();
  const packageSpec = resolveBootstrapPackageSpec(metadata, options.packageSpec);
  const { globalRoot, globalPrefix } = getGlobalNpmPaths();
  const globalPackageRoot = getGlobalPackageRoot(globalRoot, metadata.name);
  const installedVersion = getInstalledBrokerVersion(globalPackageRoot);
  const action: "installed" | "reused" =
    installedVersion === metadata.version && isRegistryLikePackageSpec(packageSpec, metadata.name)
      ? "reused"
      : "installed";

  if (!options.json) {
    if (action === "installed") {
      console.log(`Installing ${packageSpec} globally...`);
    } else {
      console.log(`Using existing global install ${metadata.name}@${metadata.version}.`);
    }
  }

  if (action === "installed") {
    const exitCode = spawnInherited("npm", ["install", "--global", packageSpec]);
    if (exitCode !== 0) {
      throw new Error(`Global install failed for ${packageSpec}.`);
    }
  }

  const runtime = resolveInstalledBrokerRuntime(
    metadata.name,
    metadata.version,
    globalPrefix,
    globalRoot,
  );
  const brokerEnv = buildBrokerCommandOverrideEnv(runtime.hostLaunch, process.env);

  if (!options.json) {
    console.log(`Using installed launcher: ${formatCommand(runtime.command, runtime.argsPrefix)}`);
  }

  const initArgs = ["init", "--host", host];
  if (options.force) {
    initArgs.push("--force");
  }
  if (options.json) {
    initArgs.push("--json");
  }

  let initResult: unknown;
  let installExitCode = 0;
  if (options.json) {
    const { output, exitCode } = runInstalledBrokerJson(runtime, initArgs, brokerEnv);
    initResult = output;
    if (exitCode !== 0) {
      throw new Error("Installed broker init failed.");
    }
  } else {
    const exitCode = runInstalledBrokerHuman(runtime, initArgs, brokerEnv);
    if (exitCode !== 0) {
      throw new Error("Installed broker init failed.");
    }
    initResult = {
      dry_run: false,
      written_files: []
    };
  }

  let doctorResult: unknown;
  if (!options.skipDoctor) {
    const doctorArgs = ["doctor", "--host", host, "--verbose"];
    if (options.json) {
      doctorArgs.push("--json");
    }

    if (options.json) {
      const { output, exitCode } = runInstalledBrokerJson(runtime, doctorArgs, brokerEnv);
      doctorResult = output;
      installExitCode = exitCode;
    } else {
      const exitCode = runInstalledBrokerHuman(runtime, doctorArgs, brokerEnv);
      installExitCode = exitCode;
    }
  }

  return {
    result: {
      package: metadata,
      global_install: {
        action,
        package_spec: packageSpec,
        package_root: runtime.packageRoot,
        version: runtime.version,
        launcher_mode: runtime.launcherMode,
        host_launch: runtime.hostLaunch
      },
      init: initResult,
      ...(doctorResult !== undefined
        ? {
            doctor: doctorResult
          }
        : {})
    },
    exitCode: installExitCode
  };
}
