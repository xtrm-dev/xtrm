/**
 * service-knowledge ext v1.2 (CORE-2714, XTRM-997)
 *
 * Replaces the stale `service-skills` extension. Self-gating registration:
 * at init it scans the session cwd for a service registry using the exact
 * semantics of the service-knowledge package's `find_umbrella_packs`
 * (packages/service-knowledge/src/service_knowledge/cli/common.py):
 *
 *   - candidate pack roots: [<cwd>/.xtrm/skills, <cwd>/.xtrm/skills/user/packs]
 *   - reserved pack names are skipped (default, optional, user, active, local-legacy)
 *   - the NEW umbrella `service-knowledge` wins over the LEGACY `service-skills`
 *   - a pack counts only if <pack>/<umbrella>/service-registry.json exists
 *
 * No registry → the extension registers NOTHING (zero surface: no tool, no
 * command, no event handlers). Live sessions load extensions from this package
 * source, so this gate is what keeps registrations airtight in non-service repos.
 *
 * With a registry, the surface is:
 *   (a) before_agent_start context note — service count + drift state
 *       (checks both the canonical .service-knowledge-drift-pending and the
 *       legacy .service-skills-drift-pending marker; canonical wins)
 *   (b) /service-knowledge:status — services, last_sync_ref vs git HEAD,
 *       drift marker presence, suggested action
 *   (c) FIVE registered tools at parity with the Python MCP server (v1.1,
 *       CORE-2714): knowledge_search, knowledge_get, knowledge_evidence_for_files,
 *       knowledge_status, knowledge_drift
 *   (d) a tool_result nudge (v1.2, XTRM-997): when a read, grep, find or a
 *       read-shaped bash command touches a registered territory, one short
 *       advisory block is appended to that tool result, naming at most three
 *       services with the exact next call. Once per service per session;
 *       advisory only, and fail-open on every path.
 *
 * Tool parity mechanism: `tool-definitions.json` is generated from the Python
 * single source of truth (`service-knowledge mcp specs --json`) and pinned by a
 * parity test on both sides. This file never hand-writes a description or a
 * schema — it renders whatever the JSON carries. Each call executes
 * `service-knowledge mcp call <tool>`, so both hosts run the same code, and the
 * host adapter always sets SERVICE_KNOWLEDGE_ROOT explicitly, so an inherited
 * CLAUDE_PROJECT_DIR cannot silently retarget a pi worker to its parent's repo.
 *
 * NON_GOALS (v1): no auto-update execution, no index rebuild trigger.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFile, execFileSync } from "node:child_process";

const NEW_UMBRELLA = "service-knowledge";
const LEGACY_UMBRELLA = "service-skills";
const RESERVED_PACK_NAMES = new Set(["default", "optional", "user", "active", "local-legacy"]);
const DRIFT_MARKER_REL = join(".xtrm", ".service-knowledge-drift-pending");
// Wave-1 repos carry the legacy marker name (mercury/infra reality); the new
// name wins when both are present (xtrm-6z6.2 coordinator finding).
const LEGACY_DRIFT_MARKER_REL = join(".xtrm", ".service-skills-drift-pending");
const RECONCILE_COMMAND = "/updating-service-knowledge";
const NUDGE_TOOLS = new Set(["read", "grep", "find", "bash"]);

/** Executable that serves the shared tool implementations (the Python CLI). */
const CLI_BIN = "service-knowledge";
/** Per-call wall-clock budget: the freshness gate has its own 90s internal budget. */
const CALL_TIMEOUT_MS = 120_000;

export interface ServiceRegistryPack {
	/** Absolute pack dir (e.g. <cwd>/.xtrm/skills/infra). */
	packDir: string;
	/** The umbrella dir that won (service-knowledge preferred over service-skills). */
	umbrellaDir: string;
	/** Umbrella name actually used. */
	umbrellaName: string;
	/** Absolute path to service-registry.json. */
	registryPath: string;
}

/** One tool definition, exactly as the Python package projects it. */
export interface ToolSpec {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

/** Shape of the committed tool-definitions.json (generated, never hand-edited). */
export interface ToolDefinitions {
	server: string;
	version: string;
	protocol_versions?: string[];
	instructions?: string;
	tools: ToolSpec[];
	deferred?: string[];
}

/** cwd plus ancestors (bounded) — xt/pi worktrees live under <repo>/.xtrm/worktrees/<name>
 *  and do not carry .xtrm state; walking up to the repo root lets worktree sessions
 *  see the registry + drift markers owned by the main checkout. */
function selfAndAncestors(cwd: string): string[] {
	const dirs: string[] = [];
	let dir = cwd;
	for (let i = 0; i < 6; i++) {
		dirs.push(dir);
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return dirs;
}

/** Candidate pack roots, mirroring find_umbrella_packs (common.py). */
function candidatePackRoots(cwd: string): string[] {
	const roots: string[] = [];
	for (const dir of selfAndAncestors(cwd)) {
		roots.push(join(dir, ".xtrm", "skills"), join(dir, ".xtrm", "skills", "user", "packs"));
	}
	return roots;
}

/**
 * Find every pack carrying a service-knowledge OR service-skills umbrella with
 * a registry. New name wins over legacy per pack (find_umbrella_packs semantics).
 */
export function findUmbrellaPacks(cwd: string): ServiceRegistryPack[] {
	const out: ServiceRegistryPack[] = [];
	const seen = new Set<string>();
	for (const root of candidatePackRoots(cwd)) {
		let packNames: string[] = [];
		try {
			packNames = readdirSync(root, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name);
		} catch {
			continue; // missing root is not an error
		}
		for (const name of packNames.sort()) {
			if (RESERVED_PACK_NAMES.has(name)) continue;
			const packDir = resolve(join(root, name));
			if (seen.has(packDir)) continue;
			for (const umbrellaName of [NEW_UMBRELLA, LEGACY_UMBRELLA]) {
				const umbrellaDir = join(packDir, umbrellaName);
				const registryPath = join(umbrellaDir, "service-registry.json");
				if (existsSync(registryPath)) {
					seen.add(packDir);
					out.push({ packDir, umbrellaDir, umbrellaName, registryPath });
					break;
				}
			}
		}
	}
	return out;
}

/** Load + validate the registry JSON; returns null on any parse/read failure. */
export function loadRegistry(registryPath: string): { services: Record<string, Record<string, unknown>> } | null {
	try {
		const raw = JSON.parse(readFileSync(registryPath, "utf8"));
		if (raw && typeof raw === "object" && raw.services && typeof raw.services === "object") {
			return raw as { services: Record<string, Record<string, unknown>> };
		}
		return null;
	} catch {
		return null;
	}
}

/** Current git HEAD short sha (fixed 7 chars); null when the cwd is not in a git repo. */
export function gitHead(cwd: string): string | null {
	try {
		return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd, encoding: "utf8" }).trim() || null;
	} catch {
		return null;
	}
}

/** Per-service last_sync_ref (first 7 chars, matching `git rev-parse --short`) from the registry; empty when absent. */
function syncRefs(registry: { services: Record<string, Record<string, unknown>> }): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [id, info] of Object.entries(registry.services)) {
		out[id] = String(info?.last_sync_ref ?? "").slice(0, 7);
	}
	return out;
}

/**
 * Whether a drift pending marker is present in this repo. Checks both the
 * canonical (service-knowledge) and legacy (service-skills) marker names;
 * the canonical one wins when both exist (xtrm-6z6.2).
 */
export function hasDriftMarker(cwd: string): boolean {
	return selfAndAncestors(cwd).some((base) => existsSync(join(base, DRIFT_MARKER_REL)) || existsSync(join(base, LEGACY_DRIFT_MARKER_REL)));
}

/** The marker file actually present (canonical preferred), or null. */
export function driftMarkerPath(cwd: string): string | null {
	for (const base of selfAndAncestors(cwd)) {
		if (existsSync(join(base, DRIFT_MARKER_REL))) return DRIFT_MARKER_REL;
		if (existsSync(join(base, LEGACY_DRIFT_MARKER_REL))) return LEGACY_DRIFT_MARKER_REL;
	}
	return null;
}

function packLabel(pack: ServiceRegistryPack): string {
	return `${pack.umbrellaName}@${pack.packDir.replace(/^.*\/\.xtrm\/skills\//, "")}`;
}

/** Build the before_agent_start context note (service count + drift state). */
function buildContextNote(cwd: string, packs: ServiceRegistryPack[]): string {
	const total = packs.reduce((acc, p) => acc + (loadRegistry(p.registryPath)?.services ? Object.keys(loadRegistry(p.registryPath)!.services).length : 0), 0);
	const lines = [
		"<service_knowledge_context>",
		`service registry: ${packs.length} pack(s), ${total} service(s)`,
		...packs.map((p) => `- ${packLabel(p)} (${Object.keys(loadRegistry(p.registryPath)?.services ?? {}).length} services)`),
		driftMarkerPath(cwd)
			? `drift: PENDING marker present (${driftMarkerPath(cwd)}) — reconcile with ${RECONCILE_COMMAND}`
			: "drift: none detected",
		"tools: knowledge_search · knowledge_get · knowledge_evidence_for_files · knowledge_status · knowledge_drift",
		"call order: knowledge_evidence_for_files before reading service source; knowledge_search before grep; knowledge_status when results look stale; knowledge_drift before trusting recently changed code",
		"</service_knowledge_context>",
	];
	return lines.join("\n");
}

function normalizePath(value: string): string {
	return value.replaceAll("\\\\", "/").replace(/^\.\//, "");
}

/** Python `fnmatch.fnmatch` as a RegExp: `*` matches any run (including `/`), `?` one char. */
function fnmatchRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped.replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`);
}

/**
 * Mirror of `match_territory` in
 * `packages/service-knowledge/src/service_knowledge/scripts/skill_activator.py` (the Python source
 * of truth), so both hosts resolve the same territory. That function is fnmatch, plus a `**`
 * split, plus a directory-prefix fallback; a plain glob conversion answers differently for the
 * common double-star python-file territory. The 14-case parity test in
 * `tests/service-knowledge.test.ts` pins this against the Python behaviour.
 */
function patternMatches(rel: string, raw: string): boolean {
	const pattern = normalizePath(raw);
	try {
		if (pattern.includes("**")) {
			const parts = pattern.split("**/");
			if (parts.length === 2) {
				const [prefix, suffix] = parts;
				const relCheck = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
				if (fnmatchRegex(suffix).test(relCheck) || fnmatchRegex(`${prefix}*/${suffix}`).test(rel)) return true;
				if (prefix && rel.startsWith(prefix.replace(/\/+$/, ""))) return true;
			}
		} else if (fnmatchRegex(pattern).test(rel)) {
			return true;
		}
		const base = pattern.split("/*")[0].split("/**")[0];
		return Boolean(base) && (rel.startsWith(`${base}/`) || rel === base);
	} catch {
		return false;
	}
}

function relativeTo(filePath: string, root: string): string {
	let rel = normalizePath(filePath);
	const norm = normalizePath(root);
	if (rel.startsWith(`${norm}/`)) rel = rel.slice(norm.length + 1);
	return rel;
}

/** Exclusive boolean parity with the Python activator, quirks included. */
export function territoryMatch(filePath: string, territory: unknown, cwd: string): boolean {
	if (typeof filePath !== "string" || !Array.isArray(territory)) return false;
	const rel = relativeTo(filePath, resolveSessionRoot(cwd));
	return territory.some((raw) => typeof raw === "string" && raw !== "" && patternMatches(rel, raw));
}

/**
 * How specific a matched pattern is: an exact path (3) beats a named file (2) beats a directory or
 * wildcard family (1). A literal path is a better answer than a broad file family such as the
 * python-file territory, and naming the better answer keeps the nudge short when territories
 * overlap.
 */
function strictScore(rel: string, raw: string): number {
	const pattern = normalizePath(raw);
	if (!pattern.includes("*") && !pattern.includes("?")) return rel === pattern ? 3 : 0;
	const basename = pattern.split("/").pop() ?? "";
	const named = basename.replace(/[*?]/g, "") !== "";
	let owned = false;
	const parts = pattern.split("**/");
	if (pattern.includes("**") && parts.length === 2) {
		const [prefix, suffix] = parts;
		if (prefix === "") owned = fnmatchRegex(`*/${suffix}`).test(rel);
		else {
			if (rel.startsWith(prefix)) owned = fnmatchRegex(suffix).test(rel.slice(prefix.length));
			if (!owned) owned = fnmatchRegex(`${prefix}*/${suffix}`).test(rel);
		}
	} else if (fnmatchRegex(pattern).test(rel)) {
		owned = true;
	}
	const base = pattern.split("/*")[0].split("/**")[0];
	if (!owned && base !== "" && (rel === base || rel.startsWith(`${base}/`))) owned = true;
	if (!owned) return 0;
	return named ? 2 : 1;
}

/**
 * Ownership, not merely "the Python matcher said yes": a double-star trailing-wildcard pattern
 * also matches a path outside its own directory through the suffix branch of `match_territory`.
 * That branch is the write gate's business, not the nudge's, so a nudge names only a service
 * whose pattern really covers the path.
 */
export function territoryScore(filePath: string, territory: unknown, root: string): number {
	if (typeof filePath !== "string" || !Array.isArray(territory)) return 0;
	const rel = relativeTo(filePath, root);
	let best = 0;
	for (const raw of territory) {
		if (typeof raw !== "string" || raw === "") continue;
		best = Math.max(best, strictScore(rel, raw));
	}
	return best;
}

const READ_COMMAND = /\b(?:cat|head|tail|sed|awk|rg|grep|find|fd|ls)\b/;

/** A sed script is not a path: `1,5p`, `$d` and `s/a/b/g` must not reach the territory matcher. */
const SED_SCRIPT = /^(?:\d+(?:,\d+)?[a-zA-Z]?|[0-9$][0-9,$]*[a-zA-Z]{1,2}|s([/#|]).*\1.*)$/;

function bashPaths(command: string): string[] {
	if (!READ_COMMAND.test(command.trim())) return [];
	return command.match(/(?:'[^']*'|"[^"]*"|[^\s;&|]+)/g)
		?.slice(1)
		.map((token) => token.replace(/^['"]|['"]$/g, ""))
		.filter((token) => token !== "" && !token.startsWith("-") && !SED_SCRIPT.test(token)) ?? [];
}

/** The paths a tool call touches. A grep pattern is not a path and is never matched. */
export function nudgePaths(toolName: string, input: Record<string, unknown>): string[] {
	const stringAt = (key: string): string | null => (typeof input[key] === "string" ? (input[key] as string) : null);
	if (toolName === "read") return [stringAt("file_path"), stringAt("path")].filter((value): value is string => value !== null);
	if (toolName === "grep" || toolName === "find") return [stringAt("path"), stringAt("file_path")].filter((value): value is string => value !== null);
	if (toolName === "bash") return bashPaths(String(input.command ?? ""));
	return [];
}

/** One injection names a few services, not a wall of territory. */
const MAX_SERVICES = 3;

interface NudgeService {
	id: string;
	info: Record<string, unknown>;
	score: number;
	/** The root-relative paths of this call that this service owns. */
	files: string[];
}

/**
 * A Grep or Glob path can be a directory. A service then owns the call when its territory lies
 * under that directory, even though no single pattern matches the bare directory name.
 */
function directoryOwned(rel: string, territory: unknown): boolean {
	const dir = rel.replace(/\/+$/, "");
	for (const raw of Array.isArray(territory) ? territory : []) {
		if (typeof raw !== "string" || raw === "") continue;
		const base = normalizePath(raw).split("/*")[0].split("/**")[0];
		// Only a pattern with a literal base inside the directory is ownership. The parity matcher's
		// suffix branch would also match here, and that is the noise this rule exists to stop.
		if (base !== "" && base.startsWith(`${dir}/`)) return true;
	}
	return false;
}

/** True when the token names a directory, so a territory underneath it counts as owned. */
function looksLikeDirectory(rel: string, root: string): boolean {
	const base = rel.split("/").pop() ?? "";
	if (!base.includes(".")) return true;
	try {
		return statSync(join(root, rel)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The most specific un-nudged services for these paths, at most MAX_SERVICES. A tie keeps every
 * co-owner, so the message never pretends one service owns territory that two services share.
 */
function bestMatches(packs: ServiceRegistryPack[], paths: string[], root: string, seen: Set<string>): NudgeService[] {
	const scored: NudgeService[] = [];
	for (const pack of packs) {
		const services = loadRegistry(pack.registryPath)?.services ?? {};
		for (const [id, info] of Object.entries(services)) {
			if (seen.has(id)) continue;
			const bucket = new Set<string>();
			let score = 0;
			for (const path of paths) {
				const rel = relativeTo(path, root);
				const own = territoryScore(path, info.territory, root);
				if (own > 0) {
					score = Math.max(score, own);
					bucket.add(rel);
				} else if (looksLikeDirectory(rel, root) && directoryOwned(rel, info.territory)) {
					score = Math.max(score, 1);
					bucket.add(rel);
				}
			}
			if (score > 0) scored.push({ id, info: info as unknown as Record<string, unknown>, score, files: [...bucket] });
		}
	}
	if (scored.length === 0) return [];
	scored.sort((left, right) => right.score - left.score);
	return scored.filter((service) => service.score === scored[0].score).slice(0, MAX_SERVICES);
}

/** The exact next call for one service. Keep byte-identical to the Claude plugin hook's text. */
function nextCall(service: NudgeService): string {
	const payload = JSON.stringify({ paths: service.files });
	const skill = typeof service.info.skill_path === "string" ? service.info.skill_path : null;
	return skill
		? `Next: knowledge_evidence_for_files ${payload}, or knowledge_get with skill_path ${skill}.`
		: `Next: knowledge_evidence_for_files ${payload}, or knowledge_get ${service.id}.`;
}

/** The advisory text. Byte-identical to `buildMessage` in the plugin's PreToolUse hook. */
function buildNudge(selected: NudgeService[], cwd: string): string {
	const drift = driftMarkerPath(cwd) ? "Drift is pending: run knowledge_drift before trusting this knowledge." : "";
	if (selected.length === 1) {
		const owner = `${selected[0].id} owns ${selected[0].files.join(", ")}. ${nextCall(selected[0])}`;
		return `[service-knowledge] ${owner}${drift ? ` ${drift}` : ""}`;
	}
	const lines = [`[service-knowledge] ${selected.length} services own these paths:`];
	for (const service of selected) lines.push(`- ${service.id} owns ${service.files.join(", ")}. ${nextCall(service)}`);
	if (drift) lines.push(drift);
	return lines.join("\n");
}

/** Return one advisory per service/session. This function never reads file contents. */
export function nudgeForToolCall(cwd: string, packs: ServiceRegistryPack[], toolName: string, input: Record<string, unknown>, seen: Set<string>): string | null {
	if (!NUDGE_TOOLS.has(toolName)) return null;
	const paths = nudgePaths(toolName, input);
	if (paths.length === 0) return null;
	const root = resolveSessionRoot(cwd);
	const selected = bestMatches(packs, paths, root, seen);
	if (selected.length === 0) return null;
	for (const { id } of selected) seen.add(id);
	return buildNudge(selected, cwd);
}

/**
 * The git toplevel for a session, used as the tool's SERVICE_KNOWLEDGE_ROOT.
 *
 * An explicit root beats cwd-relative resolution: `_root` in the Python package trusts
 * $CLAUDE_PROJECT_DIR before git, and a pi worker launched from a Claude session inherits
 * that variable. Exporting the value per call is the only mechanism that cannot silently
 * resolve a parent repo.
 */
export function resolveSessionRoot(cwd: string): string {
	try {
		const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return toplevel || cwd;
	} catch {
		return cwd;
	}
}

/** TypeBox-compatible schema: the Python JSON Schema is already what pi validates. */
function toToolParameters(spec: ToolSpec): Record<string, unknown> {
	return { type: "object", ...spec.parameters };
}

export interface ServiceKnowledgeExtensionOptions {
	/** Override the init cwd scan (tests inject a fixture dir). Defaults to process.cwd(). */
	cwd?: string;
	/** Override the committed tool definitions (tests inject a fixture). */
	definitions?: ToolDefinitions;
}

export default function serviceKnowledgeExtension(pi: ExtensionAPI, opts: ServiceKnowledgeExtensionOptions = {}) {
	const getCwd = (ctx: any) => ctx?.cwd || process.cwd();

	// Self-gating: scan once at init. No registry → register nothing at all.
	const cwd = opts.cwd || getCwd({});
	const packs = findUmbrellaPacks(cwd);
	if (packs.length === 0) {
		return; // zero surface
	}

	// (a) per-turn context note. before_agent_start is the documented injection
	// point for a custom message into the LLM context (session_start return
	// values are not consumed as messages — xtrm-vs7f8 audit finding).
	pi.on("before_agent_start", async (_event, ctx) => {
		return {
			message: {
				customType: "service-knowledge-context",
				content: buildContextNote(getCwd(ctx), packs),
				display: false,
			},
		};
	});

	// Advisory only, and delivered where the model actually reads it: a `tool_call` result cannot
	// inject context (ToolCallEventResult is block/reason/terminate), while a `tool_result` handler
	// may return replacement content. The nudge therefore appends one short block to the triggering
	// result, in the same turn — the convention pi-gitnexus uses. Fail-open: any error returns
	// undefined, so the tool result reaches the model untouched.
	const nudgedServices = new Set<string>();
	pi.on("tool_result", async (event: any, ctx: any) => {
		try {
			const content = Array.isArray(event?.content) ? event.content : null;
			if (content === null) return;
			const message = nudgeForToolCall(getCwd(ctx), packs, String(event?.toolName ?? ""), event?.input ?? {}, nudgedServices);
			if (message === null) return;
			const replaced: Record<string, unknown> = {
				content: [...content, { type: "text", text: `\n\n---\n${message}\n---` }],
			};
			// Replacing `content` alone would drop a machine-readable result; carry it through.
			if (event?.structuredContent !== undefined) replaced.structuredContent = event.structuredContent;
			return replaced;
		} catch {
			// A nudge must never affect a tool result.
			return;
		}
	});

	// (b) /service-knowledge:status command
	pi.registerCommand("service-knowledge:status", {
		description: "Show service registry status: services, last_sync_ref vs git HEAD, drift marker, suggested action",
		handler: async (_args, ctx) => {
			const repoCwd = getCwd(ctx);
			const lines: string[] = ["service-knowledge status"];
			for (const pack of packs) {
				const registry = loadRegistry(pack.registryPath);
				const svcCount = registry ? Object.keys(registry.services).length : -1;
				lines.push(`pack: ${packLabel(pack)}`);
				lines.push(`  umbrella: ${pack.umbrellaName} (registry: ${pack.registryPath})`);
				lines.push(`  services: ${svcCount}`);
				if (registry) {
					for (const [id, ref] of Object.entries(syncRefs(registry))) {
						lines.push(`  - ${id}: last_sync_ref ${ref || "(never)"}`);
					}
				}
			}
			const head = gitHead(repoCwd);
			lines.push(`git HEAD: ${head ?? "(not a git repo)"}`);
			const marker = driftMarkerPath(repoCwd);
			lines.push(`drift marker: ${marker ? `PRESENT (${marker})` : "absent"}`);
			const anyOutOfSync = packs.some((p) => {
				const registry = loadRegistry(p.registryPath);
				if (!registry) return false;
				return Object.values(syncRefs(registry)).some((ref) => ref && ref !== head);
			});
			lines.push(`suggested action: ${anyOutOfSync || hasDriftMarker(repoCwd) ? `run ${RECONCILE_COMMAND} to reconcile + stamp last_sync_ref` : "none — registry is in sync with HEAD"}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// (c) the five knowledge tools, at parity with the Python MCP server.
	// Definitions come from the generated JSON; this block renders, never authors.
	registerKnowledgeTools(pi, getCwd, opts.definitions);
}

/**
 * Register one tool per entry in the generated definitions.
 *
 * The names are BARE (`knowledge_search`, not `service_knowledge_search`) because the issue
 * contract asks for the same tool names on both hosts, and Claude adds its own host prefix on
 * its side. A flat pi namespace could collide with another extension, so a name already taken
 * is skipped with a notice instead of throwing: fail open, never break the session.
 */
function registerKnowledgeTools(
	pi: ExtensionAPI,
	getCwd: (ctx: any) => string,
	definitions?: ToolDefinitions,
): void {
	if (typeof (pi as any).registerTool !== "function") return; // host without tool registration
	const specs = definitions ?? loadCommittedDefinitions();
	if (!specs) return; // a missing definitions file must not break the session

	const taken = new Set<string>(toolNamesInUse(pi));
	for (const spec of specs.tools) {
		if (taken.has(spec.name)) {
			notifyOnce(
				pi,
				`service-knowledge: tool name '${spec.name}' is already registered by another extension; ` +
					`skipping the service-knowledge copy. Knowledge tools stay available through ` +
					`\`service-knowledge mcp call ${spec.name}\`.`,
			);
			continue;
		}
		taken.add(spec.name);
		pi.registerTool({
			name: spec.name,
			label: `Service knowledge: ${spec.name.replace(/^knowledge_/, "")}`,
			description: spec.description,
			parameters: toToolParameters(spec) as never,
			annotations: { readOnlyHint: true },
			async execute(
				_toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal,
				_onUpdate: unknown,
				ctx?: any,
			) {
				const root = resolveSessionRoot(getCwd(ctx));
				const args = { ...(params ?? {}) };
				// Never let a caller redirect the read to an arbitrary checkout: the host decides.
				delete (args as Record<string, unknown>).consumer_root;
				return callTool(spec.name, args, root, signal);
			},
		});
	}
}

/** Read the committed definitions that ship beside this file. */
function loadCommittedDefinitions(): ToolDefinitions | null {
	const here = dirname(new URL(import.meta.url).pathname);
	for (const candidate of [join(here, "tool-definitions.json"), join(process.cwd(), "tool-definitions.json")]) {
		try {
			return JSON.parse(readFileSync(candidate, "utf8")) as ToolDefinitions;
		} catch {
			continue;
		}
	}
	return null;
}

/** Names another extension already registered, when the host exposes them. */
function toolNamesInUse(pi: ExtensionAPI): string[] {
	try {
		const all = (pi as any).getAllTools?.();
		if (Array.isArray(all)) {
			return all.map((tool: any) => String(tool?.name ?? "")).filter(Boolean);
		}
	} catch {
		/* a host without getAllTools simply has no collision information */
	}
	return [];
}

const notified = new Set<string>();
function notifyOnce(pi: ExtensionAPI, message: string): void {
	if (notified.has(message)) return;
	notified.add(message);
	try {
		(pi as any).ui?.notify?.(message, "warning");
	} catch {
		/* notification is best-effort */
	}
}

/** Run the CLI asynchronously so a slow index rebuild cannot freeze the session. */
function runCli(
	argv: string[],
	root: string,
	signal?: AbortSignal,
): Promise<{ stdout: string }> {
	return new Promise((resolve, reject) => {
		execFile(
			CLI_BIN,
			argv,
			{
				cwd: root,
				encoding: "utf8",
				timeout: CALL_TIMEOUT_MS,
				maxBuffer: 32 * 1024 * 1024,
				env: { ...process.env, SERVICE_KNOWLEDGE_ROOT: root },
				...(signal ? { signal } : {}),
			},
			(error, stdout) => (error ? reject(error) : resolve({ stdout: String(stdout ?? "") })),
		);
	});
}

/**
 * Run one tool through the shared Python implementation.
 *
 * Every call passes SERVICE_KNOWLEDGE_ROOT explicitly (see resolveSessionRoot). A CLI failure is
 * returned as an error result, never thrown: a missing or old `service-knowledge` binary must
 * leave the session working with a named reason.
 *
 * Async on purpose. `execFileSync` blocks the whole event loop for as long as the CLI runs, and
 * the freshness gate's budget is 90 s: an index rebuild would freeze the session with no way to
 * press Esc. Only the async form honours the abort signal the tool API hands us.
 */
export async function callTool(
	name: string,
	args: Record<string, unknown>,
	root: string,
	signal?: AbortSignal,
): Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent?: unknown; isError?: boolean }> {
	let stdout: string;
	try {
		({ stdout } = await runCli(["mcp", "call", name, "--args-json", JSON.stringify(args)], root, signal));
	} catch (error: any) {
		const detail = String(error?.stderr || error?.message || error).trim().slice(0, 2000);
		const hint =
			error?.code === "ENOENT"
				? `the '${CLI_BIN}' CLI is not on PATH; install it with packages/service-knowledge/install.sh from an xtrm-dev/xtrm checkout (>= 0.9.0 for the mcp subcommand; it also installs vaultctl).`
				: "the service-knowledge CLI failed.";
		return { content: [{ type: "text", text: `${name}: ${hint} ${detail}` }], isError: true };
	}
	try {
		const payload = JSON.parse(stdout);
		return {
			content: [{ type: "text", text: stdout.trim() }],
			structuredContent: payload,
			isError: Boolean(payload && typeof payload === "object" && "error" in payload && Object.keys(payload).length === 1),
		};
	} catch {
		return { content: [{ type: "text", text: stdout.trim() }] };
	}
}
