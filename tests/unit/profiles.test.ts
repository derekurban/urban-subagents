import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveAgentProfiles } from "../../src/broker/profiles.js";
import type { BrokerConfig } from "../../src/broker/types.js";

describe("resolveAgentProfiles", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives runtime defaults for read-only agents", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "urban-profiles-"));
    tempDirs.push(tempDir);
    const promptFile = path.join(tempDir, "reviewer.md");
    fs.writeFileSync(promptFile, "prompt", "utf8");

    const config: BrokerConfig = {
      path: path.join(tempDir, "config.yaml"),
      source: "user",
      version: "0.1",
      broker: {
        execution_mode: "sync",
        default_output: {
          format: "text"
        }
      },
      agents: {
        reviewer: {
          description: "Review code",
          runtime: "codex_exec",
          model: "gpt-5.4",
          prompt_file: "reviewer.md"
        }
      }
    };

    const [profile] = resolveAgentProfiles(config);
    expect(profile?.codex.sandboxMode).toBe("read-only");
    expect(profile?.claude.tools).toEqual(["Read", "LS", "Glob", "Grep"]);
  });
});
