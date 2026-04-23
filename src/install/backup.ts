import fs from "node:fs";
import path from "node:path";

function sanitizeAbsolutePath(target: string): string {
  const resolved = path.resolve(target);
  return resolved
    .replace(/^[A-Za-z]:/, (match) => match.toUpperCase())
    .replace(/:/g, "")
    .replace(/^[\\/]+/, "")
    .replace(/[\\/]/g, path.sep);
}

export function createBackupRoot(backupsDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(backupsDir, stamp);
  fs.mkdirSync(backupRoot, { recursive: true });
  return backupRoot;
}

export function backupFileIfExists(target: string, backupRoot: string): string | null {
  if (!fs.existsSync(target)) {
    return null;
  }

  const relative = sanitizeAbsolutePath(target);
  const destination = path.join(backupRoot, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(target, destination);
  return destination;
}
