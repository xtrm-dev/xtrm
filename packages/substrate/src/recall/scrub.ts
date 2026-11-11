// Secret scrubbing for the recall index (CORE-2595, R1).
//
// Two hard rules drive this module:
//   1. The raw text is never stored, and FTS never sees it: scrub runs on the
//      journal row before body/title/head are inserted.
//   2. Never print, log or return a matched secret. Findings carry the rule
//      name only.
//
// The revision is derived from the rule set, so adding or changing a rule
// changes scrubVersion automatically. The indexer rebuilds when the stored
// revision differs and the query path refuses an index built with another
// revision, because an old index may still hold text the new rules scrub.

import { createHash } from "node:crypto";

export interface ScrubRule {
  id: string;
  pattern: RegExp;
  replace: string | ((match: string, sub: string | undefined) => string);
}

const REDACTED = (kind: string): string => `[REDACTED:${kind}]`;

// Secrets with a stable, recognizable shape. Ordered: more specific prefixes
// first so a later, broader rule never rewrites a placeholder.
const SHAPE_RULES: ScrubRule[] = [
  {
    id: "pem-private-key",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replace: REDACTED("private-key"),
  },
  {
    id: "pem-block",
    pattern: /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
    replace: REDACTED("pem"),
  },
  {
    id: "anthropic-key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    replace: REDACTED("anthropic-key"),
  },
  {
    id: "openai-key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: REDACTED("openai-key"),
  },
  {
    id: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replace: REDACTED("github-token"),
  },
  {
    id: "github-pat",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replace: REDACTED("github-pat"),
  },
  {
    id: "atlassian-token",
    pattern: /\b(?:ATATT|ATCTT|ATBB)[A-Za-z0-9_=+/.-]{10,}\b/g,
    replace: REDACTED("atlassian-token"),
  },
  {
    id: "aws-access-key",
    pattern: /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    replace: REDACTED("aws-access-key"),
  },
  {
    id: "bearer-token",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/g,
    replace: `Bearer ${REDACTED("bearer")}`,
  },
  {
    id: "basic-auth",
    pattern: /\bBasic\s+[A-Za-z0-9+/]{16,}=*/g,
    replace: `Basic ${REDACTED("basic-auth")}`,
  },
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replace: REDACTED("jwt"),
  },
  {
    id: "slack-token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    replace: REDACTED("slack-token"),
  },
  {
    id: "npm-token",
    pattern: /\bnpm_[A-Za-z0-9]{30,}/g,
    replace: REDACTED("npm-token"),
  },
  {
    id: "pypi-token",
    pattern: /\bpypi-[A-Za-z0-9_-]{20,}/g,
    replace: REDACTED("pypi-token"),
  },
  {
    id: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replace: REDACTED("google-api-key"),
  },
  {
    id: "stripe-key",
    pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    replace: REDACTED("stripe-key"),
  },
  {
    id: "gitlab-token",
    pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    replace: REDACTED("gitlab-token"),
  },
  {
    id: "sendgrid-key",
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
    replace: REDACTED("sendgrid-key"),
  },
  {
    id: "sentry-dsn",
    pattern: /\bhttps:\/\/[a-f0-9]{32}@[A-Za-z0-9.-]+\/\d+/g,
    replace: REDACTED("sentry-dsn"),
  },
  {
    id: "url-credentials",
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    replace: "$1[REDACTED-URL-CREDENTIALS]@",
  },
];

const SENSITIVE_SEGMENTS = new Set([
  "KEY",
  "KEYS",
  "APIKEY",
  "TOKEN",
  "TOKENS",
  "SECRET",
  "SECRETS",
  "PASSWORD",
  "PASSWORDS",
  "PASSWD",
  "PWD",
  "CRED",
  "CREDS",
  "CREDENTIAL",
  "CREDENTIALS",
]);

/** Split apiKey / API-KEY / anthropic_api_key into comparable segments. */
function nameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((part) => part.toUpperCase());
}

export function isSensitiveName(name: string): boolean {
  // The LAST segment carries the noun's meaning: apiKey/DB_SECRET are
  // sensitive, while keyDecisions, key_facts and secrets_files are metadata
  // collections that happen to start with a sensitive word.
  const parts = nameSegments(name);
  return parts.length > 0 && SENSITIVE_SEGMENTS.has(parts[parts.length - 1]!);
}

const PLACEHOLDER_VALUE =
  /^(?:\[REDACTED[^\]]*\]|<[^>]*>|\*+|x{3,}|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|null|true|false|none|nil|undefined)$/i;

// NAME=value / NAME: value / "NAME": "value". The head (name plus separator)
// is matched first and filtered by isSensitiveName; a non-sensitive name must
// NOT consume its value, because that value can itself be another assignment
// ("quoted: DB_SECRET: <secret>").
const NAME_HEAD = /(?<![A-Za-z0-9])(["']?)([A-Za-z][A-Za-z0-9_.-]{0,80})\1\s*[:=]\s*/g;
const BARE_VALUE = /^[^\s,;&}\]()\[]+/;

interface ValueSpan {
  /** Index just after the opening quote, or the value start when bare. */
  start: number;
  /** Index just after the closing quote, or the value end when bare. */
  end: number;
  value: string;
  quote: string;
}

function valueSpan(text: string, contentStart: number): ValueSpan | null {
  const quote = text[contentStart];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, contentStart + 1);
    if (close < 0) return null;
    return { start: contentStart + 1, end: close + 1, value: text.slice(contentStart + 1, close), quote };
  }
  const bare = BARE_VALUE.exec(text.slice(contentStart));
  if (!bare) return null;
  return { start: contentStart, end: contentStart + bare[0].length, value: bare[0], quote: "" };
}

function redactNameValue(text: string): { text: string; redactions: number } {
  let out = "";
  let cursor = 0;
  let redactions = 0;
  NAME_HEAD.lastIndex = 0;
  for (let match = NAME_HEAD.exec(text); match !== null; match = NAME_HEAD.exec(text)) {
    const name = match[2] as string;
    if (!isSensitiveName(name)) continue;
    const contentStart = match.index + match[0].length;
    const span = valueSpan(text, contentStart);
    if (span === null || span.value.length < 4 || PLACEHOLDER_VALUE.test(span.value)) continue;
    // "fixture token: TOKEN=<secret>" is two assignments: the outer value is
    // itself a sensitive name. Do not consume it as a value; let the inner
    // assignment be redacted on the next iteration.
    if (isSensitiveName(span.value.replace(/[:=]+$/, ""))) {
      NAME_HEAD.lastIndex = contentStart;
      continue;
    }
    out += text.slice(cursor, match.index) + match[0] + span.quote + REDACTED("value") + span.quote;
    cursor = span.end;
    redactions += 1;
    NAME_HEAD.lastIndex = span.end;
  }
  return { text: out + text.slice(cursor), redactions };
}

const HIGH_ENTROPY_CANDIDATE = /[A-Za-z0-9+/_=-]{20,}/g;
const SENSITIVE_WORD = /\b(?:KEY|KEYS|TOKEN|TOKENS|SECRET|SECRETS|PASSWORD|PASSWORDS|PASSWD|CRED|CREDS|CREDENTIALS?)\b/gi;

function shannonEntropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * A long, mixed-charset token. Digests, lowercase slugs and path fragments are
 * not secrets: the real index produced only false positives from those classes
 * (file paths, git SHAs, branch names, filenames).
 */
export function isHighEntropySecret(value: string): boolean {
  if (value.length < 24 || value.length > 512) return false;
  if (/^\d+$/.test(value)) return false;
  if (/^[0-9a-f]+$/i.test(value)) return false;
  if (/[\\/]/.test(value)) return false;
  if (!/[A-Z]/.test(value) || !/[0-9]/.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(value)).length;
  return classes >= 3 && shannonEntropy(value) >= 3.8;
}

/** High-entropy strings within 80 characters after a sensitive word. */
function redactHighEntropyNearSensitive(text: string): string {
  const lines = text.split("\n");
  const out = lines.map((line) => {
    const spans: Array<{ start: number; end: number }> = [];
    SENSITIVE_WORD.lastIndex = 0;
    for (let match = SENSITIVE_WORD.exec(line); match !== null; match = SENSITIVE_WORD.exec(line)) {
      const window = line.slice(match.index + match[0].length, match.index + match[0].length + 80);
      HIGH_ENTROPY_CANDIDATE.lastIndex = 0;
      for (let cand = HIGH_ENTROPY_CANDIDATE.exec(window); cand !== null; cand = HIGH_ENTROPY_CANDIDATE.exec(window)) {
        if (!isHighEntropySecret(cand[0])) continue;
        const start = match.index + match[0].length + cand.index;
        spans.push({ start, end: start + cand[0].length });
      }
    }
    if (spans.length === 0) return line;
    spans.sort((a, b) => a.start - b.start);
    let result = "";
    let cursor = 0;
    for (const span of spans) {
      if (span.start < cursor) continue;
      result += line.slice(cursor, span.start) + REDACTED("high-entropy");
      cursor = span.end;
    }
    return result + line.slice(cursor);
  });
  return out.join("\n");
}

export interface ScrubResult {
  text: string;
  redactions: number;
}

function countRule(text: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(global)].length;
}

export function scrubText(input: string): ScrubResult {
  if (!input) return { text: "", redactions: 0 };
  let text = input;
  let redactions = 0;
  for (const rule of SHAPE_RULES) {
    const before = text;
    text = text.replace(rule.pattern, rule.replace as string);
    if (text !== before) redactions += countRule(before, rule.pattern);
  }
  const named = redactNameValue(text);
  text = named.text;
  redactions += named.redactions;
  const afterEntropy = redactHighEntropyNearSensitive(text);
  if (afterEntropy !== text) {
    redactions += (afterEntropy.match(/\[REDACTED:high-entropy\]/g) ?? []).length;
    text = afterEntropy;
  }
  return { text, redactions };
}

/** Rule ids only: a finding never carries the matched text. */
export interface SecretFinding {
  rule: string;
}

export function scanSecrets(input: string): SecretFinding[] {
  if (!input) return [];
  const findings: SecretFinding[] = [];
  for (const rule of SHAPE_RULES) {
    const global = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
    for (const _match of input.matchAll(global)) findings.push({ rule: rule.id });
  }
  NAME_HEAD.lastIndex = 0;
  for (let match = NAME_HEAD.exec(input); match !== null; match = NAME_HEAD.exec(input)) {
    const name = match[2] as string;
    if (!isSensitiveName(name)) continue;
    const span = valueSpan(input, match.index + match[0].length);
    if (span !== null && span.value.length >= 4 && !PLACEHOLDER_VALUE.test(span.value) && !isSensitiveName(span.value.replace(/[:=]+$/, ""))) {
      findings.push({ rule: "name-value" });
    }
  }
  for (const line of input.split("\n")) {
    SENSITIVE_WORD.lastIndex = 0;
    for (let match = SENSITIVE_WORD.exec(line); match !== null; match = SENSITIVE_WORD.exec(line)) {
      const window = line.slice(match.index + match[0].length, match.index + match[0].length + 80);
      for (const cand of window.matchAll(HIGH_ENTROPY_CANDIDATE)) {
        if (isHighEntropySecret(cand[0])) findings.push({ rule: "high-entropy" });
      }
    }
  }
  return findings;
}

// The structured-JSON policy changes what is redacted, so it is part of the
// revision: an index built before it must be rebuilt, not reused.
const REVISION_SOURCE = `${SHAPE_RULES.map((rule) => `${rule.id}:${rule.pattern.source}:${rule.pattern.flags}`).join("\n")}\npolicy:structured-json-v2`;
/**
 * Scrub a parsed journal payload recursively. Object keys are the context that
 * name-value rules need: flattening first drops them, so {"password":"x"}
 * would otherwise store x verbatim. Keys are used for matching, never emitted.
 */
export function scrubJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 30) return "[REDACTED:depth]";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return scrubJsonValue(JSON.parse(trimmed), depth + 1);
      } catch {
        // not JSON: fall through to text scrubbing
      }
    }
    return scrubText(value).text;
  }
  if (Array.isArray(value)) return value.map((item) => scrubJsonValue(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveName(key) && typeof item === "string" ? "[REDACTED:value]" : scrubJsonValue(item, depth + 1);
    }
    return output;
  }
  return value;
}

export const SCRUB_VERSION = `scrub-${createHash("sha256").update(REVISION_SOURCE).digest("hex").slice(0, 12)}`;
export const SCRUB_RULE_IDS = SHAPE_RULES.map((rule) => rule.id);
