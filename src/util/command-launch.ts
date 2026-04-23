import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export interface SpawnLaunchConfig {
  command: string;
  args: string[];
  resolvedCommand: string;
}

function isWindowsPowerShellScript(command: string): boolean {
  return /\.ps1$/i.test(command);
}

function isPathLike(command: string): boolean {
  return (
    path.isAbsolute(command) ||
    command.startsWith(".") ||
    /[\\/]/.test(command)
  );
}

function resolveSiblingWindowsShim(
  command: string,
  fileExists: (target: string) => boolean,
): string | null {
  for (const extension of [".cmd", ".bat"]) {
    const candidate = command.replace(/\.ps1$/i, extension);
    if (candidate !== command && fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function preferredExecutablePath(
  candidates: readonly string[],
  platform: NodeJS.Platform,
): string | null {
  if (candidates.length === 0) {
    return null;
  }

  if (platform !== "win32") {
    return candidates[0] ?? null;
  }

  return [...candidates].sort((left, right) => {
    const rank = (candidate: string): number => {
      if (/\.exe$/i.test(candidate)) {
        return 0;
      }
      if (/\.cmd$/i.test(candidate)) {
        return 1;
      }
      if (/\.bat$/i.test(candidate)) {
        return 2;
      }
      if (/\.ps1$/i.test(candidate)) {
        return 3;
      }
      return 4;
    };

    return rank(left) - rank(right);
  })[0] ?? null;
}

function findOnPath(
  command: string,
  platform: NodeJS.Platform,
): string | null {
  const lookup = platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookup, [command], {
    encoding: "utf8",
    windowsHide: true
  });

  if (result.status !== 0) {
    return null;
  }

  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return preferredExecutablePath(candidates, platform);
}

export function resolveExecutablePath(
  command: string,
  platform: NodeJS.Platform = process.platform,
  fileExists: (target: string) => boolean = fs.existsSync,
  resolveOnPath: (command: string, platform: NodeJS.Platform) => string | null = findOnPath,
): string | null {
  const candidate = isPathLike(command)
    ? (fileExists(command) ? command : null)
    : resolveOnPath(command, platform);
  if (!candidate) {
    return null;
  }

  if (platform === "win32" && isWindowsPowerShellScript(candidate)) {
    return resolveSiblingWindowsShim(candidate, fileExists) ?? candidate;
  }

  return candidate;
}

export function buildSpawnLaunchConfig(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  fileExists: (target: string) => boolean = fs.existsSync,
  resolveOnPath: (command: string, platform: NodeJS.Platform) => string | null = findOnPath,
): SpawnLaunchConfig {
  const resolvedCommand =
    resolveExecutablePath(command, platform, fileExists, resolveOnPath) ?? command;

  if (platform === "win32" && isWindowsPowerShellScript(resolvedCommand)) {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolvedCommand,
        ...args
      ],
      resolvedCommand
    };
  }

  return {
    command: resolvedCommand,
    args: [...args],
    resolvedCommand
  };
}
