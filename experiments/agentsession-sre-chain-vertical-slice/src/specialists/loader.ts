import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import {
  parseSpecialistDocument,
  type SpecialistDocument,
  type SpecialistSpec,
} from "./schema.ts";

export type FeatureDisposition = "native" | "adapted" | "deferred" | "rejected";

export interface FeatureAssessment {
  feature: string;
  disposition: FeatureDisposition;
  reason: string;
}

export interface SpecialistSourceFingerprint {
  path: string;
  sha256: string;
  bytes: number;
}

export interface LoadedSpecialistDocument {
  /** Lossless JSON object as authored, before Zod defaults/normalization. */
  raw: Record<string, unknown>;
  /** Validated document. `.passthrough()` retains unknown/future fields. */
  document: SpecialistDocument;
  source: SpecialistSourceFingerprint;
}

export interface ResolvedSkillAsset {
  declared_path: string;
  resolved_path: string;
  name: string;
  sha256: string;
  bytes: number;
  content: string;
  outside_target_repo: boolean;
}

export interface CompiledScriptEntry {
  run: string;
  phase: "pre" | "post";
  inject_output: boolean;
  legacy_path_field: boolean;
}

export interface SpecialistActivationProfile {
  schema_version: 1;
  name: string;
  version: string;
  description: string;
  category: string;
  source: SpecialistSourceFingerprint;
  execution: {
    mode: "tool" | "skill" | "auto";
    model: string;
    fallback_models: string[];
    surface_models: Record<string, string>;
    timeout_ms: number;
    stall_timeout_ms?: number;
    max_retries: number;
    interactive: boolean;
    response_format: "text" | "json" | "markdown";
    output_type: string;
    permission_required: "READ_ONLY" | "LOW" | "MEDIUM" | "HIGH";
    requires_worktree: boolean;
    bare: boolean;
    thinking_level?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
    auto_commit: "never" | "checkpoint_on_waiting" | "checkpoint_on_terminal";
    stdout_limit_bytes?: number;
    prompt_limit_bytes?: number;
    expected_output_keys: string[];
    extensions: Record<string, unknown>;
  };
  prompt: {
    system: string;
    system_prompt_mode: "append" | "replace";
    task_template: string;
    output_schema?: Record<string, unknown>;
    skill_inherit?: string;
  };
  skills: ResolvedSkillAsset[];
  scripts: CompiledScriptEntry[];
  capabilities: {
    required_tools: string[];
    external_commands: string[];
  };
  mandatory_rules: {
    template_sets: string[];
    disable_default_globals: boolean;
    inline_rules: Array<{ id: string; level: "error" | "warn" | "info"; text: string; when?: string }>;
  };
  validation: {
    files_to_watch: string[];
    stale_threshold_days?: number;
  };
  /** Passthrough keeps future upstream fields auditable without pretending XTRM understands them. */
  stall_detection: Record<string, unknown>;
  output: {
    legacy_output_file?: string;
    notes_mode: "full-trail" | "final-only";
    beads_integration: "auto" | "always" | "never";
    beads_write_notes: boolean;
  };
  /** Explicit compatibility matrix: valid JSON never implies silently supported runtime semantics. */
  feature_matrix: FeatureAssessment[];
  /** The validated/passthrough Specialist body for auditing future fields. */
  full_specialist: SpecialistSpec;
}

export interface SpecialistLoaderOptions {
  targetRepo: string;
  strictSkills?: boolean;
  maxSkillBytes?: number;
}

export class SpecialistLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpecialistLoadError";
  }
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

/**
 * Experiment-only direct file lookup. Production should prefer injecting the
 * public @jaggerxtrm/specialists/lib SpecialistLoader through resolver.ts so
 * package/global/repo merge semantics stay upstream-owned.
 */
function candidatePaths(targetRepo: string, name: string): string[] {
  return [
    path.join(targetRepo, ".specialists", "user", `${name}.specialist.json`),
    path.join(targetRepo, ".specialists", "user", "specialists", `${name}.specialist.json`),
    path.join(targetRepo, "config", "specialists", `${name}.specialist.json`),
  ];
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function findSpecialistJson(targetRepo: string, name: string): Promise<string> {
  for (const candidate of candidatePaths(path.resolve(targetRepo), name)) {
    if (await isFile(candidate)) return candidate;
  }
  throw new SpecialistLoadError(
    `specialist '${name}' not found. Checked:\n${candidatePaths(path.resolve(targetRepo), name).map((p) => `  - ${p}`).join("\n")}`,
  );
}

export async function loadSpecialistJson(sourcePath: string): Promise<LoadedSpecialistDocument> {
  const absolute = path.resolve(expandHome(sourcePath));
  let content: string;
  try {
    content = await fs.readFile(absolute, "utf8");
  } catch (error: any) {
    throw new SpecialistLoadError(`cannot read specialist JSON ${absolute}: ${error?.message ?? error}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error: any) {
    throw new SpecialistLoadError(`invalid JSON in ${absolute}: ${error?.message ?? error}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SpecialistLoadError(`specialist JSON root must be an object: ${absolute}`);
  }

  const document = parseSpecialistDocument(raw, absolute);
  return {
    raw: raw as Record<string, unknown>,
    document,
    source: {
      path: absolute,
      sha256: sha256(content),
      bytes: Buffer.byteLength(content),
    },
  };
}

export async function loadSpecialistFromRepo(
  targetRepo: string,
  name: string,
): Promise<LoadedSpecialistDocument> {
  return loadSpecialistJson(await findSpecialistJson(targetRepo, name));
}

async function resolveSkillAsset(
  targetRepo: string,
  declaredPath: string,
  maxBytes: number,
): Promise<ResolvedSkillAsset> {
  const expanded = expandHome(declaredPath);
  let candidate = path.isAbsolute(expanded) ? expanded : path.resolve(targetRepo, expanded);
  let stat = await fs.stat(candidate).catch(() => null);
  if (stat?.isDirectory()) {
    candidate = path.join(candidate, "SKILL.md");
    stat = await fs.stat(candidate).catch(() => null);
  }
  if (!stat?.isFile()) {
    throw new SpecialistLoadError(`declared skill not found: ${declaredPath} (resolved ${candidate})`);
  }
  if (stat.size > maxBytes) {
    throw new SpecialistLoadError(
      `declared skill exceeds ${maxBytes} bytes: ${declaredPath} (${stat.size} bytes)`,
    );
  }

  const real = await fs.realpath(candidate);
  const content = await fs.readFile(real, "utf8");
  const repoReal = await fs.realpath(targetRepo).catch(() => path.resolve(targetRepo));
  const relative = path.relative(repoReal, real);
  const outside = relative.startsWith("..") || path.isAbsolute(relative);
  const base = path.basename(real);
  const name = base === "SKILL.md" ? path.basename(path.dirname(real)) : base.replace(/\.md$/i, "");
  return {
    declared_path: declaredPath,
    resolved_path: real,
    name,
    sha256: sha256(content),
    bytes: Buffer.byteLength(content),
    content,
    outside_target_repo: outside,
  };
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim()))));
}

function featureMatrix(spec: SpecialistSpec, skills: ResolvedSkillAsset[]): FeatureAssessment[] {
  const features: FeatureAssessment[] = [
    {
      feature: "metadata + source fingerprint",
      disposition: "native",
      reason: "validated and retained losslessly for activation provenance",
    },
    {
      feature: "execution.model/fallback_models/thinking_level",
      disposition: "native",
      reason: "maps directly to Pi AgentSession model/scoped-model/thinking configuration",
    },
    {
      feature: "execution.max_retries",
      disposition: "native",
      reason: "maps to Pi SettingsManager retry configuration for the activation",
    },
    {
      feature: "execution.timeout/stall",
      disposition: "deferred",
      reason: "values are compiled and frozen, but XTRM does not yet enforce the Specialist-specific timeout/stall policy in this bridge",
    },
    {
      feature: "execution.permission_required + permissions",
      disposition: "adapted",
      reason: "write-capable tiers are rejected; LOW/READ_ONLY never auto-enable Pi builtins and require host capability mapping",
    },
    {
      feature: "prompt.system + system_prompt_mode",
      disposition: "adapted",
      reason: "Specialist cognition is retained, but XTRM host/tool/authority kernel always remains authoritative",
    },
    {
      feature: "prompt.task_template",
      disposition: "native",
      reason: "compiled with one-pass variable substitution so injected task data is never re-interpreted as template source",
    },
    {
      feature: "skills.paths",
      disposition: "native",
      reason: `resolved and content-hashed by the host (${skills.length} asset${skills.length === 1 ? "" : "s"}); no slash-command side effect required`,
    },
    {
      feature: "skills.scripts",
      disposition: (spec.skills?.scripts?.length ?? 0) > 0 ? "deferred" : "native",
      reason: (spec.skills?.scripts?.length ?? 0) > 0
        ? "arbitrary host script execution requires an explicit capability/preflight executor; loader retains but never auto-runs it"
        : "no scripts declared",
    },
    {
      feature: "capabilities.required_tools/external_commands",
      disposition: "deferred",
      reason: "requirements are compiled and visible, but complete host-tool aliasing/PATH preflight is not yet enforced by this bridge",
    },
    {
      feature: "mandatory_rules.inline_rules",
      disposition: "native",
      reason: "retained for deterministic host-side injection",
    },
    {
      feature: "mandatory_rules.template_sets/default globals",
      disposition: (spec.mandatory_rules?.template_sets?.length ?? 0) > 0 || !spec.mandatory_rules?.disable_default_globals
        ? "deferred"
        : "native",
      reason: "template-set/default-global loading needs a canonical Specialists asset resolver; missing sets must never be silently skipped",
    },
    {
      feature: "prompt.output_schema + execution.expected_output_keys",
      disposition: (spec.prompt.output_schema || (spec.execution.expected_output_keys?.length ?? 0) > 0) ? "deferred" : "native",
      reason: (spec.prompt.output_schema || (spec.execution.expected_output_keys?.length ?? 0) > 0)
        ? "contract is retained but not yet compiled into the authoritative evidence validator"
        : "no structured terminal-output contract declared",
    },
    {
      feature: "output_file",
      disposition: spec.output_file ? "adapted" : "native",
      reason: spec.output_file
        ? "legacy file path is retained as an optional projection; XTRM evidence store is authoritative"
        : "no legacy output file declared",
    },
    {
      feature: "beads_integration/beads_write_notes/notes_mode",
      disposition: "adapted",
      reason: "retained as intent, but ChainRun Epic/step Beads are owned and reconciled by the XTRM runtime",
    },
    {
      feature: "execution.interactive",
      disposition: spec.execution.interactive ? "deferred" : "native",
      reason: spec.execution.interactive
        ? "logical durability is XTRM-owned; keepalive/multi-turn optimization is not yet implemented by the full-JSON bridge"
        : "single activation semantics match directly",
    },
    {
      feature: "execution.extensions",
      disposition: Object.keys(spec.execution.extensions ?? {}).some((key) => (spec.execution.extensions as any)?.[key])
        ? "deferred"
        : "native",
      reason: "extensions require an explicit host extension registry; unknown/future extension flags stay lossless in full_specialist",
    },
  ];

  if (spec.execution.auto_commit !== "never") {
    features.push({
      feature: "execution.auto_commit",
      disposition: "rejected",
      reason: "the SRE vertical slice is read-only; automatic git mutation cannot be activated by Specialist JSON",
    });
  }
  if (spec.execution.permission_required === "MEDIUM" || spec.execution.permission_required === "HIGH") {
    features.push({
      feature: "write-capable permission tier",
      disposition: "rejected",
      reason: "this harness is a read-only SRE runtime; write-capable Specialists require a different governed capability profile",
    });
  }
  return features;
}

export async function compileSpecialistActivationProfile(
  loaded: LoadedSpecialistDocument,
  options: SpecialistLoaderOptions,
): Promise<SpecialistActivationProfile> {
  const spec = loaded.document.specialist;
  if (!spec.execution.model) {
    throw new SpecialistLoadError(`specialist '${spec.metadata.name}' has no execution.model after validation`);
  }

  const strictSkills = options.strictSkills ?? true;
  const maxSkillBytes = options.maxSkillBytes ?? 128 * 1024;
  const skills: ResolvedSkillAsset[] = [];
  for (const declared of spec.skills?.paths ?? []) {
    try {
      skills.push(await resolveSkillAsset(path.resolve(options.targetRepo), declared, maxSkillBytes));
    } catch (error) {
      if (strictSkills) throw error;
    }
  }

  const scripts: CompiledScriptEntry[] = (spec.skills?.scripts ?? []).map((entry) => ({
    run: entry.run ?? entry.path!,
    phase: entry.phase,
    inject_output: entry.inject_output,
    legacy_path_field: !entry.run && Boolean(entry.path),
  }));

  const fallbackModels = uniq([
    spec.execution.fallback_model,
    ...(spec.execution.fallback_models ?? []),
  ]);

  const profile: SpecialistActivationProfile = {
    schema_version: 1,
    name: spec.metadata.name,
    version: spec.metadata.version,
    description: spec.metadata.description,
    category: spec.metadata.category,
    source: loaded.source,
    execution: {
      mode: spec.execution.mode,
      model: spec.execution.model,
      fallback_models: fallbackModels,
      surface_models: { ...(spec.execution.surface_models ?? {}) },
      timeout_ms: spec.execution.timeout_ms,
      stall_timeout_ms: spec.execution.stall_timeout_ms,
      max_retries: spec.execution.max_retries,
      interactive: spec.execution.interactive,
      response_format: spec.execution.response_format,
      output_type: spec.execution.output_type,
      permission_required: spec.execution.permission_required,
      requires_worktree: spec.execution.requires_worktree,
      bare: spec.execution.bare,
      thinking_level: spec.execution.thinking_level,
      auto_commit: spec.execution.auto_commit,
      stdout_limit_bytes: spec.execution.stdout_limit_bytes,
      prompt_limit_bytes: spec.execution.prompt_limit_bytes,
      expected_output_keys: [...(spec.execution.expected_output_keys ?? [])],
      extensions: { ...(spec.execution.extensions ?? {}) },
    },
    prompt: {
      system: spec.prompt.system ?? "",
      system_prompt_mode: spec.prompt.system_prompt_mode,
      task_template: spec.prompt.task_template,
      output_schema: spec.prompt.output_schema,
      skill_inherit: spec.prompt.skill_inherit,
    },
    skills,
    scripts,
    capabilities: {
      required_tools: [...(spec.capabilities?.required_tools ?? [])],
      external_commands: [...(spec.capabilities?.external_commands ?? [])],
    },
    mandatory_rules: {
      template_sets: [...(spec.mandatory_rules?.template_sets ?? [])],
      disable_default_globals: spec.mandatory_rules?.disable_default_globals ?? false,
      inline_rules: [...(spec.mandatory_rules?.inline_rules ?? [])],
    },
    validation: {
      files_to_watch: [...(spec.validation?.files_to_watch ?? [])],
      stale_threshold_days: spec.validation?.stale_threshold_days,
    },
    stall_detection: { ...(spec.stall_detection ?? {}) },
    output: {
      legacy_output_file: spec.output_file,
      notes_mode: spec.notes_mode,
      beads_integration: spec.beads_integration,
      beads_write_notes: spec.beads_write_notes,
    },
    feature_matrix: [],
    full_specialist: spec,
  };
  profile.feature_matrix = featureMatrix(spec, skills);
  return profile;
}

export function assertSpecialistCompatible(profile: SpecialistActivationProfile): void {
  const rejected = profile.feature_matrix.filter((feature) => feature.disposition === "rejected");
  if (rejected.length === 0) return;
  throw new SpecialistLoadError(
    `specialist '${profile.name}' requests features rejected by this runtime:\n` +
    rejected.map((item) => `  - ${item.feature}: ${item.reason}`).join("\n"),
  );
}

export async function loadAndCompileSpecialist(
  targetRepo: string,
  name: string,
  options: Omit<SpecialistLoaderOptions, "targetRepo"> = {},
): Promise<SpecialistActivationProfile> {
  const loaded = await loadSpecialistFromRepo(targetRepo, name);
  const profile = await compileSpecialistActivationProfile(loaded, {
    targetRepo,
    ...options,
  });
  assertSpecialistCompatible(profile);
  return profile;
}

/** One-pass template rendering. Values are inserted literally and never rescanned. */
export function renderSpecialistTaskTemplate(
  profile: SpecialistActivationProfile,
  variables: Record<string, string>,
): string {
  return profile.prompt.task_template.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, a, b) => {
    const key = (a ?? b) as string;
    return variables[key] ?? "";
  });
}

export function renderInlineMandatoryRules(profile: SpecialistActivationProfile): string {
  if (profile.execution.bare || profile.mandatory_rules.inline_rules.length === 0) return "";
  return [
    "## MANDATORY_RULES — specialist inline",
    ...profile.mandatory_rules.inline_rules.map((rule) =>
      `- [${rule.level}] ${rule.text}${rule.id ? ` (id: ${rule.id})` : ""}`,
    ),
  ].join("\n");
}

/**
 * Host-side cognition layer for a direct AgentSession activation.
 *
 * `system_prompt_mode=replace` replaces only the Specialist cognition layer.
 * It NEVER replaces Pi's host/tool kernel or XTRM's authority doctrine — doing
 * that would recreate the tool-discovery bug found in the original experiment.
 */
export function renderSpecialistSystemLayer(
  profile: SpecialistActivationProfile,
  xtrmDoctrine: string,
  roleOverlay = "",
): string {
  const skills = profile.skills.map((skill) =>
    `## Loaded skill: ${skill.name}\n<!-- source=${skill.resolved_path} sha256=${skill.sha256} -->\n${skill.content.trim()}`,
  );
  const adaptation = [
    "## XTRM native-harness adaptation — authoritative",
    `- Specialist source: ${profile.source.path} @ sha256:${profile.source.sha256}`,
    "- You are cognition inside an XTRM-governed participant activation; you are NOT the workflow scheduler.",
    "- Do not create or dispatch successor participants, poll child jobs, or implement wait/retry loops in prose.",
    "- Do not use `sp`, `bd`, or `xtmux` as workflow authority. XTRM owns topology, Beads reconciliation, scheduling, retries, Channels and completion.",
    "- Legacy output_file and bead-note instructions are projections only. Publish governed evidence and channel messages through host tools.",
    "- AgentSession end is not step satisfaction. The host validates evidence/result contracts after you stop.",
    "- Attention is not authority; only host-provided assignment/action-targets authorize work.",
  ].join("\n");

  return [
    xtrmDoctrine.trim(),
    profile.prompt.system.trim(),
    ...skills,
    roleOverlay.trim(),
    adaptation,
  ].filter(Boolean).join("\n\n---\n\n");
}
