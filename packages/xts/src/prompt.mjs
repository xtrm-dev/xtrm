// Prompt assembly for XTS (PRD §7.3, §11.1, §15). Pure module: no I/O.
// The system prompt stays small and fixed; the per-run user message carries
// the instruction, stdin evidence, and shell context.
import { formatShellContext } from "./context.mjs";

// Task 4 keeps the PRD §15 draft wording; task 7's runtime wiring owns final
// tuning of the system prompt.
export const SYSTEM_PROMPT = `You are XTS, a fast terminal assistant.

Help the user operate the current shell environment.

Prefer direct, concise answers.

Use bash when inspection or execution is necessary. Bash runs in the [shell
context] working directory, which may differ from the question's subject or
piped [stdin evidence] — inspect such targets by absolute path.

Inspect before mutating when state is unclear.

Do not modify files unless the user's request requires it.

Do not explain routine shell commands unless explanation is useful.

When the situation offers a genuinely useful lesson, you may end your answer
with one short line starting with "HINT:" that teaches a related technique or
gotcha. Keep it to one line; skip it when there is nothing worth teaching.`;

// Default instruction when the user passes no positional argument. Piped
// stdin is primary evidence; the model answers from it.
export const DEFAULT_INSTRUCTION = "Describe the current shell state and answer any implied question.";

// Heuristic token estimate: ~4 chars per token. Used by tests to assert the
// system prompt stays within budget.
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function buildSystemPrompt() {
  return SYSTEM_PROMPT;
}

// Per-run user message envelope. Instruction, stdin, and shell context are
// each optional; absent blocks are omitted, so the envelope stays token-lean.
// The truncation notice (when present) is part of the stdin block and is
// always visible to the model.
export function buildUserMessage({ instruction, stdin, shellContext }) {
  const blocks = [];

  const instr =
    instruction && instruction.trim() !== ""
      ? instruction.trim()
      : DEFAULT_INSTRUCTION;
  blocks.push(instr);

  if (stdin) {
    const lines = [
      `[stdin evidence — ${stdin.keptBytes} bytes. Piped input is the SUBJECT of the\n` +
        `request: answer about it, using your bash tool for any inspection it needs\n` +
        `(locate items by absolute path — never your own working directory instead).]`,
      stdin.content,
    ];
    if (stdin.notice) lines.push(stdin.notice);
    blocks.push(lines.join("\n"));
  }

  if (shellContext) {
    blocks.push(`[shell context]\n${formatShellContext(shellContext)}`);
  }

  return blocks.join("\n\n");
}
