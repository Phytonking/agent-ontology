import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function isRepo(root: string): boolean {
  return fs.existsSync(path.join(root, ".git"));
}

/** Initialize a git repo in `root` if one doesn't exist yet. */
export function ensureRepo(root: string): void {
  if (!isRepo(root)) {
    try {
      git(root, ["init"]);
    } catch {
      /* git not available — edits still write to disk, just unversioned */
    }
  }
}

export interface CommitResult {
  committed: boolean;
  warning?: string;
}

/**
 * Stage `files` and commit them. Falls back to a default identity if the
 * environment has no git user configured, so agent edits are always versioned.
 */
export function commit(root: string, files: string[], message: string): CommitResult {
  try {
    git(root, ["add", ...files]);
  } catch (e) {
    return { committed: false, warning: `git add failed: ${firstLine(e)}` };
  }
  try {
    git(root, ["commit", "-m", message]);
    return { committed: true };
  } catch {
    // retry with a fallback identity (covers machines with no global git config)
    try {
      git(root, [
        "-c",
        "user.email=agent@ontolayer.local",
        "-c",
        "user.name=ontolayer",
        "commit",
        "-m",
        message,
      ]);
      return { committed: true };
    } catch (e2) {
      return { committed: false, warning: `git commit skipped: ${firstLine(e2)}` };
    }
  }
}

function firstLine(e: unknown): string {
  return (e as Error).message.split("\n")[0];
}
