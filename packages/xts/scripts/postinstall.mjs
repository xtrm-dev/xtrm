#!/usr/bin/env node
// Idempotent shell-hook enablement for XTS (runs on npm install / npm link).
// Appends a marked, silent eval line to the rc matching the login shell so
// command-history context (PRD §9) is a durable default. Never fails install.
import { appendFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MARKER = "# xts shell history";

try {
  if (process.env.XTS_SKIP_HOOK_INSTALL || process.env.CI) process.exit(0);
  const shell = path.basename(process.env.SHELL || "bash");
  const rcName = shell === "zsh" ? ".zshrc" : ".bashrc";
  const rcPath = path.join(os.homedir(), rcName);
  let content = "";
  try {
    content = await readFile(rcPath, "utf8");
  } catch {
    // missing rc — appendFile creates it
  }
  if (content.includes(MARKER)) process.exit(0);
  await appendFile(
    rcPath,
    `\n${MARKER}\ncommand -v xts >/dev/null 2>&1 && eval "$(xts shellhook)"\n`,
  );
} catch {
  // best-effort only: an rc problem must never break installation
}
process.exit(0);
