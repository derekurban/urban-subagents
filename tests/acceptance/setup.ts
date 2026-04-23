import fs from "node:fs";
import path from "node:path";

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

if (process.platform !== "win32") {
  for (const target of [
    path.resolve("tests", "acceptance", "support", "provider-proxy", "claude"),
    path.resolve("tests", "acceptance", "support", "provider-proxy", "codex")
  ]) {
    if (fs.existsSync(target)) {
      fs.chmodSync(target, 0o755);
    }
  }
}
