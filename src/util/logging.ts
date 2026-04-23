import fs from "node:fs";
import path from "node:path";

import { getStatePaths } from "./paths.js";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function write(scope: string, level: LogLevel, message: string, data?: Record<string, unknown>) {
  const { logsDir } = getStatePaths();
  fs.mkdirSync(logsDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const target = path.join(logsDir, `${date}.jsonl`);
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    ...(data ? { data } : {})
  };

  fs.appendFileSync(target, JSON.stringify(entry) + "\n", "utf8");
}

export function createLogger(scope: string): Logger {
  return {
    debug(message, data) {
      write(scope, "debug", message, data);
    },
    info(message, data) {
      write(scope, "info", message, data);
    },
    warn(message, data) {
      write(scope, "warn", message, data);
    },
    error(message, data) {
      write(scope, "error", message, data);
    }
  };
}
