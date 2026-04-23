import fs from "node:fs";

import * as TOML from "@iarna/toml";

export function readTomlFile<T extends Record<string, unknown>>(target: string): T {
  if (!fs.existsSync(target)) {
    return {} as T;
  }

  const raw = fs.readFileSync(target, "utf8");
  if (!raw.trim()) {
    return {} as T;
  }

  return TOML.parse(raw) as T;
}

export function stringifyToml(value: Record<string, unknown>): string {
  return TOML.stringify(value as never).trimEnd() + "\n";
}
