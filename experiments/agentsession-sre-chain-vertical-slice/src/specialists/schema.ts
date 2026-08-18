import { z } from "zod";

const KebabCase = z.string().regex(/^[a-z][a-z0-9-]*$/, "must be kebab-case");
const Semver = z.string().regex(/^\d+\.\d+\.\d+$/, "must be semver");

export const SpecialistMetadataSchema = z.object({
  name: KebabCase,
  version: Semver,
  description: z.string().min(1),
  category: z.string().min(1),
  updated: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();

export const SpecialistExecutionSchema = z.object({
  mode: z.enum(["tool", "skill", "auto"]).default("auto"),
  model: z.string().nullable(),
  surface_models: z.record(z.string()).optional(),
  fallback_model: z.string().nullable().optional(),
  fallback_models: z.array(z.string()).nullable().optional(),
  timeout_ms: z.number().int().positive().default(120_000),
  stall_timeout_ms: z.number().int().positive().optional(),
  max_retries: z.number().int().min(0).default(0),
  interactive: z.boolean().default(false),
  stdout_limit_bytes: z.number().int().positive().optional(),
  prompt_limit_bytes: z.number().int().positive().optional(),
  response_format: z.enum(["text", "json", "markdown"]).default("text"),
  output_type: z.enum([
    "codegen",
    "analysis",
    "review",
    "synthesis",
    "orchestration",
    "workflow",
    "research",
    "custom",
  ]).default("custom"),
  permission_required: z.enum(["READ_ONLY", "LOW", "MEDIUM", "HIGH"]).default("READ_ONLY"),
  requires_worktree: z.boolean().default(true),
  bare: z.boolean().default(false),
  thinking_level: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  auto_commit: z.enum(["never", "checkpoint_on_waiting", "checkpoint_on_terminal"]).default("never"),
  extensions: z.object({
    serena: z.boolean().optional(),
    gitnexus: z.boolean().optional(),
  }).passthrough().optional(),
  expected_output_keys: z.array(z.string()).optional(),
}).passthrough();

export const SpecialistPromptSchema = z.object({
  system: z.string().optional(),
  system_prompt_mode: z.enum(["append", "replace"]).default("append"),
  task_template: z.string().min(1),
  output_schema: z.record(z.unknown()).optional(),
  skill_inherit: z.string().optional(),
}).passthrough();

/**
 * Current Specialists canonical schema uses `run`; the runner still accepts
 * legacy `path`. XTRM accepts either at the ingestion boundary and normalizes
 * to `run` in the compiled profile so old assets cannot silently disappear.
 */
export const SpecialistScriptEntrySchema = z.object({
  run: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  phase: z.enum(["pre", "post"]),
  inject_output: z.boolean().default(false),
}).passthrough().superRefine((value, ctx) => {
  if (!value.run && !value.path) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["run"],
      message: "script requires run (or legacy path)",
    });
  }
});

export const SpecialistSkillsSchema = z.object({
  paths: z.array(z.string().min(1)).optional(),
  scripts: z.array(SpecialistScriptEntrySchema).optional(),
}).passthrough().optional();

export const SpecialistCapabilitiesSchema = z.object({
  required_tools: z.array(z.string()).optional(),
  external_commands: z.array(z.string()).optional(),
}).passthrough().optional();

export const SpecialistValidationSchema = z.object({
  files_to_watch: z.array(z.string()).optional(),
  stale_threshold_days: z.number().positive().optional(),
}).passthrough().optional();

export const MandatoryRuleSchema = z.object({
  id: z.string(),
  level: z.enum(["error", "warn", "info"]).default("error"),
  text: z.string().min(1),
  when: z.string().optional(),
}).passthrough();

export const SpecialistMandatoryRulesSchema = z.object({
  template_sets: z.array(KebabCase).default([]),
  disable_default_globals: z.boolean().default(false),
  inline_rules: z.array(MandatoryRuleSchema).default([]),
}).passthrough().optional();

const PermissionTierSchema = z.object({
  denied_natives_when_extension: z.array(z.string()).optional(),
  denied_natives_mode: z.enum(["soft", "hard"]).optional(),
}).passthrough();

export const SpecialistPermissionsSchema = z.object({
  READ_ONLY: PermissionTierSchema.optional(),
  LOW: PermissionTierSchema.optional(),
  MEDIUM: PermissionTierSchema.optional(),
  HIGH: PermissionTierSchema.optional(),
}).partial().passthrough().optional();

export const SpecialistStallDetectionSchema = z.object({
  running_silence_warn_ms: z.number().int().positive().optional(),
  running_silence_error_ms: z.number().int().positive().optional(),
  waiting_stale_ms: z.number().int().positive().optional(),
  waiting_auto_close_ms: z.number().int().positive().nullable().optional(),
  tool_duration_warn_ms: z.number().int().positive().optional(),
}).passthrough().optional();

export const SpecialistDocumentSchema = z.object({
  specialist: z.object({
    metadata: SpecialistMetadataSchema,
    execution: SpecialistExecutionSchema,
    prompt: SpecialistPromptSchema,
    skills: SpecialistSkillsSchema,
    capabilities: SpecialistCapabilitiesSchema,
    validation: SpecialistValidationSchema,
    stall_detection: SpecialistStallDetectionSchema,
    mandatory_rules: SpecialistMandatoryRulesSchema,
    permissions: SpecialistPermissionsSchema,
    output_file: z.string().optional(),
    notes_mode: z.enum(["full-trail", "final-only"]).default("full-trail"),
    beads_integration: z.enum(["auto", "always", "never"]).default("auto"),
    beads_write_notes: z.boolean().default(true),
  }).passthrough(),
}).passthrough();

export type SpecialistDocument = z.infer<typeof SpecialistDocumentSchema>;
export type SpecialistSpec = SpecialistDocument["specialist"];
export type SpecialistScriptEntry = z.infer<typeof SpecialistScriptEntrySchema>;

export interface SpecialistValidationIssue {
  path: string;
  message: string;
  code: string;
}

export class SpecialistSchemaError extends Error {
  constructor(
    readonly sourcePath: string,
    readonly issues: SpecialistValidationIssue[],
  ) {
    super(
      `Specialist schema validation failed for ${sourcePath}:\n` +
      issues.map((issue) => `  - ${issue.path || "<root>"}: ${issue.message}`).join("\n"),
    );
    this.name = "SpecialistSchemaError";
  }
}

export function parseSpecialistDocument(raw: unknown, sourcePath = "<memory>"): SpecialistDocument {
  const parsed = SpecialistDocumentSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));
  throw new SpecialistSchemaError(sourcePath, issues);
}
