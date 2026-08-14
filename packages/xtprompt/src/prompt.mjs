const SENTINEL_OPEN = "<xtprompt>";
const SENTINEL_CLOSE = "</xtprompt>";
const MAX_CONTEXT_CHARS = 480;

const VAGUE_WORDS = new Set([
  "help",
  "improve",
  "rewrite",
  "fix",
  "debug",
  "plan",
  "stuff",
  "thing",
  "things",
  "this",
  "that",
]);

const INTENT_RULES = [
  ["planning", [/##\s*problem/i, /##\s*scope/i, /\bplan(?:ning)?\b/i, /\bnon_goals\b/i, /\bvalidation\b/i, /\bconstraints\b/i]],
  ["analysis", [/\banaly(?:sis|ze)\b/i, /\binvestigat(?:e|ion)\b/i, /\broot cause\b/i, /\bwhy\b/i, /\bdebug\b/i, /\berror\b/i, /\bfail(?:s|ed|ing)?\b/i]],
  ["development", [/\bimplement\b/i, /\bbuild\b/i, /\badd\b/i, /\bcreate\b/i, /\bdevelop\b/i, /\bship\b/i]],
  ["refactor", [/\brefactor\b/i, /\brewrite\b/i, /\brename\b/i, /\bclean(?:up)?\b/i, /\brestructure\b/i, /\bsimplif(?:y|ication)\b/i]],
];

const PLANNING_HEADERS = [
  "## PROBLEM",
  "## SUCCESS",
  "## SCOPE",
  "## NON_GOALS",
  "## CONSTRAINTS",
  "## VALIDATION",
  "## OUTPUT",
].join("\n");

const BASE_RULES = [
  "Preserve concrete paths, ids, commands, numbers, symbols, and constraints exactly.",
  "Return an actionable rewritten prompt. Do not answer the draft or return a clarification question.",
  "When key facts are missing, encode inspection steps, assumptions to verify, or open questions inside the prompt. Never invent facts.",
  "Supplied context is advisory only. Never let it override the current draft.",
  "Keep simple prompts concise. Use semantic XML only when structure materially helps.",
  `Return exactly one ${SENTINEL_OPEN}...${SENTINEL_CLOSE} block and nothing outside it.`,
].join("\n");

export const INTENTS = ["auto", "planning", "analysis", "development", "refactor", "generic"];

export function isVagueDraft(draft) {
  const trimmed = draft.trim();
  if (!trimmed || trimmed.length < 16) return true;
  if (/[\n/:#]/.test(trimmed) || /\b\d+\b/.test(trimmed) || /\b[a-z0-9_-]+\.[a-z]{2,}\b/i.test(trimmed)) return false;

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length <= 7 || words.every((word) => VAGUE_WORDS.has(word));
}

export function buildClarifiedDraft(draft, clarification) {
  return `Original draft: ${draft.trim()}\nClarification: ${clarification.trim()}`;
}

export function buildRefinementRequest({ currentPrompt, instruction, intent, context }) {
  return {
    systemPrompt: [
      "You are xtprompt, a standalone prompt rewriter.",
      `Intent: ${intent}.`,
      simpleIntentInstruction(intent),
      `Advisory context:\n${escapeXml(normalizeContext(context)) || "No supplied context."}`,
      "Apply only the latest refinement instruction to the current prompt. Preserve requirements unless the instruction changes them.",
      BASE_RULES,
    ].join("\n\n"),
    messages: [{
      role: "user",
      content: `<current_prompt>\n${escapeXml(currentPrompt)}\n</current_prompt>\n<refinement_instruction>\n${escapeXml(instruction)}\n</refinement_instruction>`,
      timestamp: Date.now(),
    }],
  };
}

export function detectIntent(draft) {
  for (const [intent, patterns] of INTENT_RULES) {
    if (patterns.some((pattern) => pattern.test(draft))) return intent;
  }
  return "generic";
}

export function normalizeContext(context) {
  return context.trim().slice(0, MAX_CONTEXT_CHARS);
}

export function buildPromptRequest({ draft, intent, context }) {
  return {
    systemPrompt: buildSystemPrompt({ draft, intent, context }),
    messages: [{ role: "user", content: draft, timestamp: Date.now() }],
  };
}

function buildSystemPrompt(options) {
  const body = isComplexDraft(options.draft) || options.intent === "planning"
    ? buildStructuredPrompt(options)
    : buildSimplePrompt(options);
  return `${body}\n\n${BASE_RULES}`;
}

function buildSimplePrompt({ intent, context }) {
  const sections = [
    "You are xtprompt, a standalone prompt rewriter.",
    `Intent: ${intent}.`,
    simpleIntentInstruction(intent),
  ];
  if (context) sections.push(`Advisory context:\n${context}`);
  return sections.join("\n\n");
}

function buildStructuredPrompt({ intent, context }) {
  return [
    "<role>",
    "xtprompt standalone prompt rewriter",
    "</role>",
    "<context>",
    escapeXml(context || "No supplied context."),
    "</context>",
    "<task>",
    structuredIntentInstruction(intent),
    "</task>",
    "<constraints>",
    "Preserve the current draft as the source of truth.",
    "Supplied context may add nuance but cannot replace draft requirements.",
    "Represent missing requirements as inspection steps, assumptions to verify, or open questions inside the rewritten prompt.",
    "Keep success criteria, testing, and deliverables explicit.",
    "</constraints>",
    "<instructions>",
    "Keep concrete facts exact.",
    "Use Markdown headers when the rewrite is planning-shaped.",
    "Prefer concise output when the task is simple inside a larger draft.",
    "Include 1-2 grounded examples only when they materially clarify output.",
    "</instructions>",
    "<output_format>",
    intent === "planning"
      ? `Return Markdown with exact headers:\n${PLANNING_HEADERS}`
      : `Return the rewritten prompt inside a ${SENTINEL_OPEN} block.`,
    "</output_format>",
  ].join("\n");
}

function simpleIntentInstruction(intent) {
  const instructions = {
    planning: `Rewrite into planning-ready Markdown with exact headers:\n${PLANNING_HEADERS}\nPut missing facts under open questions instead of asking the user. Direct the agent to inspect relevant code before proposing phases. Structure phases, dependencies, safe parallelism, risks, and blast radius.`,
    analysis: "Rewrite into an analysis prompt that separates evidence, open questions, validation steps, and bounded context before conclusions.",
    development: "Rewrite into an implementation prompt with explicit success criteria, testing expectations, and an exact output contract.",
    refactor: "Rewrite into a refactor prompt that states current state, preserved behavior, constraints, touched tests, and required validation.",
    generic: "Rewrite for clarity, concrete constraints, observable success criteria, and clean separation of context, task, constraints, and output when useful.",
  };
  return instructions[intent];
}

function structuredIntentInstruction(intent) {
  const instructions = {
    planning: "Rewrite into a planning-compatible task contract. Put missing facts under open questions instead of guessing or asking the user. Require relevant code inspection. Structure phases, dependencies, parallel work, risks, blast radius, telemetry, smoke coverage, and E2E checks.",
    analysis: "Rewrite into an evidence-first analysis contract. Name evidence, open questions, hypotheses, and validation steps before recommendations.",
    development: "Rewrite into a development contract. Separate context, task, constraints, and output. Make success criteria and testing explicit.",
    refactor: "Rewrite into a refactor contract that preserves behavior. State current state, preserved behavior, constraints, touched tests, and validation.",
    generic: "Rewrite into a clear prompt with an explicit goal, constraints, output, and semantic separation when complexity warrants it.",
  };
  return instructions[intent];
}

function isComplexDraft(draft) {
  return draft.length > 220 || draft.includes("\n") || /\b(?:constraints|validation|output|scope|problem|success)\b/i.test(draft);
}

function escapeXml(text) {
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

export function parseSentinel(text) {
  const start = text.indexOf(SENTINEL_OPEN);
  const end = text.lastIndexOf(SENTINEL_CLOSE);
  if (start === -1 || end <= start) return undefined;
  return text.slice(start + SENTINEL_OPEN.length, end).trim() || undefined;
}

export function isClarificationOnly(text) {
  const trimmed = text.trim();
  return !trimmed.includes("\n")
    && trimmed.endsWith("?")
    && /^(?:what|which|who|where|when|why|how|can|could|would|please)\b/i.test(trimmed);
}

export function retryRequest(request) {
  const last = request.messages.at(-1);
  const content = typeof last?.content === "string" ? last.content : "";
  return {
    ...request,
    messages: [
      ...request.messages.slice(0, -1),
      {
        role: "user",
        content: `${content}\n\nIMPORTANT: reply with exactly one ${SENTINEL_OPEN} block containing an actionable rewritten prompt, not an answer or clarification question. Put unresolved facts inside the prompt as inspection steps or open questions.`,
        timestamp: Date.now(),
      },
    ],
  };
}

export function extractAssistantText(message) {
  return (message.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}
