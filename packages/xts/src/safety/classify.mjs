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
  "kill -9": "forced process termination",
  pkill: "process-wide process termination",
  killall: "process-wide process termination",
});

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
    const words = tokenize(segment);
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

// This is a deliberately small shell lexer, not a shell parser. It tracks
// quotes and escapes so operators inside quoted arguments remain literals.
// Command substitutions are split even inside double quotes because they run.
// Conservative: one dangerous segment makes the whole command dangerous.
function splitSegments(command) {
  const segments = [];
  let start = 0;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (char === "'") {
      quote = "'";
      continue;
    }

    const commandSubstitution = char === "$" && command[i + 1] === "(";
    const backtickSubstitution = char === "`";
    if (commandSubstitution || backtickSubstitution) {
      const segment = command.slice(start, i).trim();
      if (segment) segments.push(segment);
      const open = commandSubstitution ? i + 2 : i + 1;
      const close = commandSubstitution
        ? findClosing(command, open, "(", ")")
        : command.indexOf("`", open);
      if (close === -1) {
        start = open;
        i = open - 1;
      } else {
        segments.push(...splitSegments(command.slice(open, close)));
        start = close + 1;
        i = close;
      }
      continue;
    }
    if (";&|()\n".includes(char)) {
      const segment = command.slice(start, i).trim();
      if (segment) segments.push(segment);
      start = i + 1;
    }
  }

  const tail = command.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
}

function findClosing(command, start, open, close) {
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let i = start; i < command.length; i += 1) {
    const char = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (char === "'") {
      quote = "'";
      continue;
    }
    if (char === open) depth += 1;
    if (char === close && --depth === 0) return i;
  }
  return -1;
}

function tokenize(segment) {
  const words = [];
  let word = "";
  let quote = null;
  let escaped = false;
  let hasWord = false;

  for (const char of segment) {
    if (escaped) {
      word += char;
      escaped = false;
      hasWord = true;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      hasWord = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
      hasWord = true;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else word += char;
      hasWord = true;
      continue;
    }
    if (char === '"') {
      quote = quote === '"' ? null : '"';
      hasWord = true;
      continue;
    }
    if (char === "'") {
      quote = "'";
      hasWord = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (hasWord) words.push(word);
      word = "";
      hasWord = false;
      continue;
    }
    word += char;
    hasWord = true;
  }
  if (escaped) word += "\\";
  if (hasWord) words.push(word);
  return words;
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

function matchProcess(words) {
  if (words[0] === "pkill") return { pattern: "pkill", reason: D.pkill };
  if (words[0] === "killall") return { pattern: "killall", reason: D.killall };
  if (words[0] !== "kill") return undefined;
  const forced = words.some((word) =>
    ["-9", "-KILL", "-SIGKILL", "-1", "--signal=KILL", "--signal=SIGKILL"].includes(word),
  );
  if (forced) return { pattern: "kill -9", reason: D["kill -9"] };
  return undefined;
}

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

// `find / -exec rm -rf {} +` — destructive recursive deletion via find.
function matchFindExec(words) {
  if (words[0] !== "find") return undefined;
  const execIdx = words.indexOf("-exec");
  if (execIdx === -1) return undefined;
  const target = words[execIdx + 1];
  if (!target) return undefined;
  const nested = matchSegment([target, ...words.slice(execIdx + 2)]);
  if (nested) return { pattern: "find -exec", reason: `destructive find -exec: ${nested.reason}` };
  return undefined;
}

const MATCHERS = [
  matchRm,
  matchFindExec,
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
  matchProcess,
  matchContainer,
];

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

// Commands that invoke a nested command string via -c: `bash -c "..."`.
const C_STRING_COMMANDS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish", "pwsh"]);

/**
 * Resolve the command word to its canonical name: strip path prefixes and
 * wrapper command names, so /usr/bin/rm -rf and env FOO=1 rm -rf are seen.
 * Returns the remaining words with the canonical command at index 0.
 */
function commandName(word) {
  if (!word) return word;
  return word.includes("/") || word.startsWith("./") ? word.split("/").pop() : word;
}

function normalizeWords(rawWords) {
  const words = [...rawWords];
  while (words.length > 0) {
    words[0] = commandName(words[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      words.shift();
      continue;
    }
    if (!WRAPPER_COMMANDS.has(words[0])) break;
    const wrapper = words.shift();
    if (wrapper === "env") {
      while (words.length > 0 && words[0].startsWith("-")) {
        const option = words.shift();
        if (option === "--") break;
        if (["-u", "--unset", "-C", "--chdir"].includes(option)) words.shift();
      }
    } else if (wrapper === "nice" && words[0] === "-n") {
      words.splice(0, 2);
    } else if (wrapper === "stdbuf" && words.length > 0 && words[0].startsWith("-")) {
      words.shift();
    }
  }
  if (words.length > 0) words[0] = commandName(words[0]);
  return words;
}

/**
 * Extract the nested command string from `bash -c "..."` (or -c '...').
 * The payload may span multiple words when the shell split it on whitespace
 * ("rm -rf /tmp/x" arrives as ["\"rm", "-rf", "/tmp/x\""]). Rejoin words
 * inside the quotes. Returns null when the form is not a -c invocation.
 */
function extractCString(words) {
  if (words.length < 3 || !C_STRING_COMMANDS.has(commandName(words[0]))) return null;
  const cIdx = words.indexOf("-c");
  if (cIdx === -1 || cIdx + 1 >= words.length) return null;
  return words[cIdx + 1];
}

function matchSegment(rawWords) {
  // 1) canonicalize the command word (strip path/env/wrappers).
  let words = normalizeWords(rawWords);
  if (words.length === 0) return undefined;

  // 2) nested command strings: bash -c "rm -rf /tmp" — classify the payload.
  const cString = extractCString(words);
  if (cString !== null && cString.length > 0) {
    const nested = classifyCommand(cString);
    if (!nested.safe) return nested;
  }
  if (words.length === 0) return undefined;

  // 3) git global options: `git -C <dir> reset --hard` — skip them.
  if (words[0] === "git") {
    const optionsWithArguments = new Set([
      "-C",
      "-c",
      "--git-dir",
      "--work-tree",
      "--namespace",
      "--exec-path",
      "--config-env",
    ]);
    let i = 1;
    while (i < words.length && words[i].startsWith("-")) {
      if (optionsWithArguments.has(words[i])) i += 2;
      else i += 1;
    }
    if (i > 1) words = ["git", ...words.slice(i)];
  }

  // 4) xargs operands: skip xargs' own options, then classify the command it
  // will invoke. This covers path-qualified commands and nested `sh -c`.
  if (words[0] === "xargs") {
    const operand = words.slice(1);
    const optionsWithArguments = new Set(["-d", "-E", "-I", "-L", "-n", "-P", "--delimiter", "--eof", "--replace", "--max-lines", "--max-args", "--max-procs"]);
    let i = 0;
    while (i < operand.length && operand[i].startsWith("-")) {
      if (operand[i] === "--") {
        i += 1;
        break;
      }
      if (optionsWithArguments.has(operand[i])) i += 2;
      else i += 1;
    }
    if (i < operand.length) {
      const nested = matchSegment(operand.slice(i));
      if (nested) return nested;
    }
  }

  for (const matcher of MATCHERS) {
    const match = matcher(words);
    if (match) return match;
  }
  return undefined;
}
