import type { Contract, ContractEntry } from "../types.ts";

// Substrate `WorkContract` (packages/substrate/src/domain/contract.ts):
// problem, success, scope[], nonGoals[], constraints[], validation[{check}], output[{artifact}],
// optional references[], libraries[], telemetry[], rollback[], dependencies[], plus extra keys.

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function entries(v: unknown, key: "check" | "artifact"): ContractEntry[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    if (typeof item === "string") return { text: item, raw: null };
    if (item && typeof item === "object") {
      const raw = item as Record<string, unknown>;
      return { text: typeof raw[key] === "string" ? (raw[key] as string) : "", raw };
    }
    return { text: String(item), raw: null };
  });
}

export function parseContract(wire: unknown): Contract {
  const raw = wire && typeof wire === "object" && !Array.isArray(wire) ? (wire as Record<string, unknown>) : {};
  return {
    problem: typeof raw.problem === "string" ? raw.problem : "",
    success: typeof raw.success === "string" ? raw.success : "",
    scope: strings(raw.scope),
    nonGoals: strings(raw.nonGoals),
    constraints: strings(raw.constraints),
    validation: entries(raw.validation, "check"),
    output: entries(raw.output, "artifact"),
    references: strings(raw.references),
    raw,
  };
}

export type ContractPatch = Partial<Pick<Contract, "problem" | "success" | "scope" | "nonGoals" | "constraints" | "references">> & {
  validation?: string[];
  output?: string[];
};

/** Apply a patch onto the raw contract; untouched fields and unknown keys are preserved byte for byte. */
export function patchContract(contract: Contract, patch: ContractPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...contract.raw };
  for (const key of ["problem", "success"] as const) if (patch[key] !== undefined) next[key] = patch[key];
  for (const key of ["scope", "nonGoals", "constraints", "references"] as const) if (patch[key] !== undefined) next[key] = patch[key]!.filter((s) => s.trim());
  const rebuild = (texts: string[], old: ContractEntry[], key: "check" | "artifact") =>
    texts
      .filter((t) => t.trim())
      .map((text, i) => {
        const prev = old[i];
        return prev?.raw && prev.text === text ? prev.raw : { ...(prev?.raw ?? {}), [key]: text };
      });
  if (patch.validation !== undefined) next.validation = rebuild(patch.validation, contract.validation, "check");
  if (patch.output !== undefined) next.output = rebuild(patch.output, contract.output, "artifact");
  // Substrate requires these arrays to exist.
  for (const key of ["scope", "nonGoals", "constraints", "validation", "output"]) if (!Array.isArray(next[key])) next[key] = [];
  return next;
}

// ---------------------------------------------------------------------------
// Imported-contract normalization. Beads imports stored the whole contract as
// Markdown inside `problem` (`## PROBLEM`, `## SCOPE`, …) and filled typed fields
// with "TBD — imported from Beads" placeholders.

type Field = "problem" | "success" | "scope" | "nonGoals" | "constraints" | "validation" | "output" | "references";

const SECTION_FIELDS: Array<[RegExp, Field]> = [
  [/^(problem|context|background)\b/i, "problem"],
  [/^(success|outcome|goal)\b/i, "success"],
  [/^(non[\s_-]?goals?|out[\s_-]of[\s_-]scope)\b/i, "nonGoals"],
  [/^scope\b/i, "scope"],
  [/^constraints?\b/i, "constraints"],
  [/^(validation|acceptance(\s+criteria)?|tests?)\b/i, "validation"],
  [/^(output|deliverables?)\b/i, "output"],
  [/^(references?|evidence)\b/i, "references"],
];

const HEADING = /^(#{1,3})\s+(.+?)\s*$/;

export const isPlaceholder = (s: string) => !s.trim() || /^TBD\b/i.test(s.trim());

interface Section {
  heading: string | null;
  field: Field | null;
  body: string;
}

function splitSections(markdown: string): Section[] {
  const sections: Section[] = [{ heading: null, field: null, body: "" }];
  let fence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = fence ? null : HEADING.exec(line);
    const title = m?.[2]?.replace(/[*_`]/g, "").trim() ?? "";
    const field = m ? (SECTION_FIELDS.find(([re]) => re.test(title))?.[1] ?? null) : null;
    if (m && field) sections.push({ heading: title, field, body: "" });
    else sections[sections.length - 1]!.body += `${line}\n`;
  }
  return sections.map((s) => ({ ...s, body: s.body.replace(/^\n+|\s+$/g, "") }));
}

/** Top-level list items; a body without bullets becomes one item. */
export function listItems(body: string): string[] {
  const items: string[] = [];
  let bulletSeen = false;
  for (const line of body.split("\n")) {
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      bulletSeen = true;
      items.push(bullet[1]!.trim());
    } else if (bulletSeen && line.trim() && items.length) {
      items[items.length - 1] += `\n${line.trim()}`;
    } else if (!bulletSeen && line.trim()) {
      items.push(line.trim());
    }
  }
  if (!bulletSeen && items.length > 1) return [items.join("\n")];
  return items.filter(Boolean);
}

export interface NormalizationPlan {
  patch: ContractPatch;
  mapped: Array<{ heading: string; field: Field; items: number }>;
}

/** Returns a plan when `problem` embeds contract sections and the typed fields are empty or placeholders; otherwise null. */
export function planNormalization(contract: Contract): NormalizationPlan | null {
  const sections = splitSections(contract.problem);
  const typed = sections.filter((s) => s.field && s.field !== "problem");
  if (!typed.length) return null;

  const patch: ContractPatch = {};
  const mapped: NormalizationPlan["mapped"] = [];
  const problemParts: string[] = [];

  for (const s of sections) {
    if (!s.field || s.field === "problem") {
      if (s.body) problemParts.push(s.body);
      continue;
    }
    const empty = (() => {
      switch (s.field) {
        case "success":
          return isPlaceholder(contract.success);
        case "validation":
          return contract.validation.every((e) => isPlaceholder(e.text));
        case "output":
          return contract.output.every((e) => isPlaceholder(e.text));
        default:
          return contract[s.field].length === 0;
      }
    })();
    if (!empty || !s.body) {
      // The typed field already carries real content: keep this section in problem.
      problemParts.push(`## ${s.heading}\n\n${s.body}`);
      continue;
    }
    if (s.field === "success") {
      patch.success = patch.success ? `${patch.success}\n\n${s.body}` : s.body;
      mapped.push({ heading: s.heading!, field: "success", items: 1 });
    } else {
      const items = listItems(s.body);
      const prev = (patch[s.field] as string[] | undefined) ?? [];
      (patch as Record<string, string[]>)[s.field] = [...prev, ...items];
      mapped.push({ heading: s.heading!, field: s.field, items: items.length });
    }
  }
  if (!mapped.length) return null;
  patch.problem = problemParts.join("\n\n").trim() || contract.problem;
  return { patch, mapped };
}
