// XTRM operating primer for every session (XTRM-637).
//
// Wired as a matcher-free SessionStart entry, so it fires on startup, resume,
// clear and compact in any repository. Reads ONLY the global skills at
// ~/.xtrm/skills/default/<skill>/SKILL.md - never the project directory, so a
// repo that does not vendor the skills gets the same primer. Injects each
// skill's preamble plus a fixed set of named sections as additionalContext,
// and says when to load the full skill.
//
// Section headings are the interface: a renamed heading drops that section, a
// missing skill drops that skill, no skill at all emits nothing. Any error
// degrades to no context and exit 0, per hook discipline.
//
// Self-contained on purpose (no resolveSubstrate): the installed substrate
// package and the plugin cache can be older than the plugin, so a TypeScript
// handler would not resolve. See session-precondition.mjs for the same shape.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

const SKILLS = [
  {
    name: "using-xtrm",
    sections: ["The system contract", "Completion rule"],
    load: "before substantial work, when choosing between local work, subagents, xt peers, Specialists or a workflow, and when handing work off",
  },
  {
    name: "multiplexing",
    sections: ["Native first", "Durable work is separate from transport", "Failure rules"],
    load: "whenever two or more live agents, subagents or xt sessions collaborate, message each other or wait on each other",
  },
];

function excerpt(text, sections) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body
    .split(/^(?=## )/m)
    .filter((part) => !part.startsWith("## ") || sections.includes(part.split("\n", 1)[0].slice(3).trim()))
    .map((part) => part.trim())
    .join("\n\n")
    .replace(/^# .*\n+/, "")
    .trim();
}

function buildPrimer() {
  const root = join(homedir(), ".xtrm", "skills", "default");
  const loads = [];
  const blocks = [];
  for (const { name, sections, load } of SKILLS) {
    let text;
    try {
      text = readFileSync(join(root, name, "SKILL.md"), "utf8");
    } catch {
      continue;
    }
    const body = excerpt(text, sections);
    if (!body) continue;
    loads.push(`- /${name}: ${load}`);
    blocks.push(`### ${name} (excerpt)\n\n${body}`);
  }
  if (blocks.length === 0) return null;
  return [
    "XTRM operating primer, condensed from the global skills in ~/.xtrm/skills/default. This is an excerpt, not the full doctrine. Load the full skill with its slash command:",
    loads.join("\n"),
    ...blocks,
  ].join("\n\n");
}

// CORE-2390: xt exports who launched this worker and its Substrate participant.
// Unknown stays absent: no variable, no line.
function launchIdentity(env) {
  const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const name = clean(env.XTRM_DISPATCHER_NAME);
  const address = clean(env.XTRM_DISPATCHER_ADDRESS);
  const holder = clean(env.SUBSTRATE_HOLDER);
  const lines = [];
  if (name || address) {
    const who = name && address ? `${name} (${address})` : name ?? address;
    lines.push(`You were dispatched by ${who}. Report to it and ask it questions with SendMessage to ${address ?? name}.`);
  }
  if (holder) {
    lines.push(`Your Substrate participant is ${holder}: claim your Issue with --holder ${holder}; your journal entries already carry it.`);
  }
  return lines.length ? `### Launch identity\n\n${lines.join("\n")}` : null;
}

const ALWAYS_ON = `XTRM always-on rules (primer-injected; excerpt — load the full skill before relying on it).

- Run identity: a PR marker's run= takes the worker's own runtime session id — PI_SESSION_ID in Pi, the Claude session id in Claude — never XTRM_SESSION_ID or XTRM_PARENT_SESSION_ID, which are tmux session ids ($N) that every window in one tmux session shares (CORE-2619; the gh shim refuses a $N run=).`;

let context = null;
try {
  context = [launchIdentity(process.env), ALWAYS_ON, buildPrimer()].filter(Boolean).join("\n\n") || null;
} catch {
  context = null;
}

process.stdout.write(
  JSON.stringify({
    additionalContext: context ?? undefined,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context ?? "" },
  }) + "\n",
);
process.exitCode = 0;
