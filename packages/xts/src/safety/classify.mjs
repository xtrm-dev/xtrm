// XTS dangerous-command classifier.
//
// Deterministic, pure, no I/O. Adapted from @aliou/pi-guardrails@0.16.1
// (src/core/commands/dangerous.ts) — read-only reference; the package is
// never imported at runtime.
//
// Guardrails parity decision: `rm` is flagged only when recursive AND force
// both appear (`rm -rf` and variants). `rm -r` alone is not flagged, matching
// the reference implementation. The git matchers are XTS additions.

export const DEFAULT_PATTERN_DESCRIPTIONS = Object.freeze({
  "rm -rf": "recursive force delete",
  shred: "secure file overwrite",
  sudo: "privileged command execution",
  doas: "privileged command execution",
  pkexec: "privileged command execution",
  "dd of=": "disk write operation",
  mkfs: "filesystem format",
  wipefs: "filesystem wipe",
  blkdiscard: "filesystem wipe",
  fdisk: "disk partitioning",
  parted: "disk partitioning",
  "chmod -R 777": "insecure recursive permissions",
  "chown -R": "recursive ownership change",
  container: "dangerous container operation",
  "git push --force": "force push",
  "git reset --hard": "hard reset",
  "git clean -fdx": "clean with force",
});

// Prefixes whose following word is the real command. sudo/doas/pkexec are NOT
// here: they are flagged as dangerous themselves.
const WRAPPER_COMMANDS = new Set([
  "eval",
  "exec",
  "env",
  "nice",
  "nohup",
  "command",
  "setsid",
  "stdbuf",
]);

/**
 * Classify a shell command string.
 *
 * Returns { safe: true } or { safe: false, reason, pattern }.
 * The whole string is classified: if ANY segment (split on ; | && || and
 * subshell delimiters) matches a dangerous pattern, the command is dangerous.
 * extraPatterns is an array of { pattern, description } substring-matched
 * against the whole command (config.mjs may supply these later).
 */
export function classifyCommand(command, { extraPatterns = [] } = {}) {
  if (typeof command !== "string") {
    throw new TypeError("classifyCommand: command must be a string");
  }

  for (const segment of splitSegments(command)) {
    let words = segment.split(/\s+/).filter(Boolean);
    if (WRAPPER_COMMANDS.has(words[0])) words = words.slice(1);
    if (words.length === 0) continue;
    const match = matchSegment(words);
    if (match) return { safe: false, reason: match.reason, pattern: match.pattern };
  }

  for (const extra of extraPatterns) {
    if (extra?.pattern && command.includes(extra.pattern)) {
      return { safe: false, reason: extra.description ?? extra.pattern, pattern: extra.pattern };
    }
  }

  return { safe: true };
}

/** Convenience boolean wrapper. */
export function isSafe(command, options) {
  return classifyCommand(command, options).safe;
}

// Split on statement/pipe separators, subshell delimiters and backticks so
// every embedded segment is classified independently. Conservative: one
// dangerous segment makes the whole command dangerous.
function splitSegments(command) {
  return command
    .split(/[;&|()\n]+|`/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasArg(words, prefix) {
  return words.some((w) => w.startsWith(prefix));
}

// Handles grouped short options: -rf, -fr, -Rfv, etc.
function hasShortFlag(words, flag) {
  return words.some(
    (w) =>
      w === `-${flag}` ||
      (w.startsWith("-") && !w.startsWith("--") && w.includes(flag)),
  );
}

function hasLongOption(words, option) {
  return words.some((w) => w === `--${option}`);
}

const D = DEFAULT_PATTERN_DESCRIPTIONS;

function matchRm(words) {
  if (words[0] !== "rm") return undefined;
  const recursive =
    hasShortFlag(words, "r") ||
    hasShortFlag(words, "R") ||
    hasLongOption(words, "recursive") ||
    hasLongOption(words, "dir");
  const force = hasShortFlag(words, "f") || hasLongOption(words, "force");
  if (recursive && force) return { pattern: "rm -rf", reason: D["rm -rf"] };
  return undefined;
}

function simple(cmd, pattern) {
  return (words) => (words[0] === cmd ? { pattern, reason: D[pattern] } : undefined);
}

const shred = simple("shred", "shred");
const sudo = simple("sudo", "sudo");
const doas = simple("doas", "doas");
const pkexec = simple("pkexec", "pkexec");
const wipefs = simple("wipefs", "wipefs");
const blkdiscard = simple("blkdiscard", "blkdiscard");

function matchDd(words) {
  if (words[0] !== "dd" || !hasArg(words, "of=")) return undefined;
  return { pattern: "dd of=", reason: D["dd of="] };
}

function matchMkfs(words) {
  const cmd = words[0];
  if (cmd !== "mkfs" && !cmd.startsWith("mkfs.")) return undefined;
  return { pattern: "mkfs", reason: D.mkfs };
}

function matchPartitioning(words) {
  const cmd = words[0];
  if (["fdisk", "sfdisk", "cfdisk"].includes(cmd)) {
    return { pattern: "fdisk", reason: D.fdisk };
  }
  if (["parted", "sgdisk"].includes(cmd)) {
    return { pattern: "parted", reason: D.parted };
  }
  return undefined;
}

function matchChmod(words) {
  if (words[0] !== "chmod") return undefined;
  const recursive = hasShortFlag(words, "R") || hasLongOption(words, "recursive");
  const worldWritable = words.some((w) =>
    ["777", "0777", "a+rwx", "ugo+rwx", "7777", "1777"].includes(w),
  );
  if (!recursive || !worldWritable) return undefined;
  return { pattern: "chmod -R 777", reason: D["chmod -R 777"] };
}

function matchChown(words) {
  if (words[0] !== "chown") return undefined;
  const recursive = hasShortFlag(words, "R") || hasLongOption(words, "recursive");
  if (!recursive) return undefined;
  return { pattern: "chown -R", reason: D["chown -R"] };
}

// XTS additions: clearly destructive git operations (PRD §14.1).
function matchGit(words) {
  if (words[0] !== "git") return undefined;
  const sub = words[1];

  if (sub === "push") {
    const force = words.some((w) => w === "-f" || w.startsWith("--force"));
    if (force) return { pattern: "git push --force", reason: D["git push --force"] };
  }

  if (sub === "reset" && words.some((w) => w === "--hard")) {
    return { pattern: "git reset --hard", reason: D["git reset --hard"] };
  }

  if (sub === "clean") {
    const force = hasShortFlag(words, "f");
    const dirsOrUntracked = hasShortFlag(words, "d") || hasShortFlag(words, "x");
    if (force && dirsOrUntracked) {
      return { pattern: "git clean -fdx", reason: D["git clean -fdx"] };
    }
  }

  return undefined;
}

const CONTAINER_HOST_FLAGS = [
  ["--privileged", "container with privileged mode"],
  ["--pid", "container with host PID namespace"],
  ["--network", "container with host network"],
  ["--userns", "container with host user namespace"],
  ["--uts", "container with host UTS namespace"],
  ["--ipc", "container with host IPC"],
];

function matchContainer(words) {
  const cmd = words[0];
  if (cmd !== "docker" && cmd !== "podman") return undefined;
  const sub = words[1];
  if (sub !== "run" && sub !== "create") return undefined;

  for (const [flag, reason] of CONTAINER_HOST_FLAGS) {
    if (flag === "--privileged") {
      if (words.some((w) => w === flag || w.startsWith("--privileged="))) {
        return { pattern: "container", reason };
      }
    } else {
      // equals form (--network=host) and adjacent form (--network host)
      const equals = words.some((w) => w.startsWith(`${flag}=host`));
      const adjacent = words.some((w, i) => w === flag && words[i + 1] === "host");
      if (equals || adjacent) return { pattern: "container", reason };
    }
  }

  const rootMount =
    words.some(
      (w) =>
        w.startsWith("-v/:") ||
        w.startsWith("-v/=>") ||
        w.startsWith("--volume=/:") ||
        (w.includes("type=bind") && w.includes("source=/")) ||
        (w.startsWith("-v") && w.includes(":/")) ||
        (w.startsWith("--volume") && w.includes(":/")),
    ) ||
    words.some(
      (w, i) => ["-v", "--volume", "--mount"].includes(w) && words[i + 1]?.startsWith("/:"),
    );
  if (rootMount) return { pattern: "container", reason: "container with root filesystem mount" };

  const socketMount = words.some(
    (w) =>
      w.includes("/var/run/docker.sock") ||
      w.includes("/run/docker.sock") ||
      w.includes("/var/run/podman.sock") ||
      w.includes("/run/podman.sock"),
  );
  if (socketMount) return { pattern: "container", reason: "container with docker socket access" };

  return undefined;
}

const MATCHERS = [
  matchRm,
  shred,
  sudo,
  doas,
  pkexec,
  matchDd,
  matchMkfs,
  wipefs,
  blkdiscard,
  matchPartitioning,
  matchChmod,
  matchChown,
  matchGit,
  matchContainer,
];

function matchSegment(words) {
  for (const matcher of MATCHERS) {
    const match = matcher(words);
    if (match) return match;
  }
  return undefined;
}
