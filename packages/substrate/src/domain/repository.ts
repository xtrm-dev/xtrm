// Repository identity (ADR sbcloseout4 §§3, 7-15, 98; bead XTRM-252.1).
//
// A Substrate Project maps to a Git repository, not to a checkout path: a
// moved checkout, a linked worktree and a second clone of one remote are the
// same repository and must resolve to the same Project (ADR §3, §7). This
// module owns the derivation legs only — normalization, deterministic Project
// identity, the collision policy and base-branch evidence. Storage and
// adoption live in `service/repository-service.ts`; CLI surfaces and
// resolution order belong to R2.
//
// Identity is derived, never guessed (ADR §98): `normalizeRemote` returns null
// for anything that is not a recognized remote, and a repository with no
// usable remote falls back to a deterministic *local* key derived from the Git
// common root (ADR §9). No identity is ever invented from a display label, a
// Project name or model prose.

export interface RepositoryIdentity {
  // Canonical key: normalized `host/owner/.../repo` for a repository with a
  // usable remote, or `local:<absolute git common root>` without one.
  repositoryKey: string;
  // Normalized remote, credentials stripped; null when the repository has no
  // remote (unknown stays absent, ADR §98).
  canonicalRemote: string | null;
  // True when the key was derived from the Git common root rather than a remote.
  local: boolean;
}

export interface ProjectIdentity {
  id: string;
  prefix: string;
  name: string;
}

// Mirrors the persisted repository_bindings row (migration 008).
export interface RepositoryBinding {
  repositoryKey: string;
  projectId: string;
  baseBranch: string | null;
  canonicalRemote: string | null;
  createdAt: number;
  updatedAt: number;
}

export const LOCAL_KEY_PREFIX = "local:";

// Accepted transport schemes. `file://`, `ftp://`, `hg://` and arbitrary text
// are not repository remotes: they normalize to null and the caller falls back
// to local identity rather than fabricating a remote.
const ACCEPTED_SCHEMES = new Set(["ssh", "git", "git+ssh", "ssh+git", "https", "http"]);

// Only the scheme's own default port is dropped. A non-default port is part of
// the canonical identity: `host:2222/a/repo` and `host:22/a/repo` may be
// different servers, and merging them would share one Project across two
// repositories, which ADR §5 forbids.
const DEFAULT_PORTS: Record<string, string> = {
  ssh: "22",
  git: "22",
  "git+ssh": "22",
  "ssh+git": "22",
  https: "443",
  http: "80",
};

/**
 * Normalize a Git remote URL to a canonical repository key (ADR §8).
 *
 * Equivalent inputs normalize to one key:
 *
 *   git@github.com:xtrm-dev/specialists.git   -> github.com/xtrm-dev/specialists
 *   https://github.com/xtrm-dev/specialists   -> github.com/xtrm-dev/specialists
 *   ssh://git@github.com/xtrm-dev/specialists.git -> github.com/xtrm-dev/specialists
 *
 * Rules: userinfo (and any credential it carries) is stripped before the key is
 * formed, the transport scheme is dropped, `.git` and trailing slashes are
 * removed, query/fragment suffixes are dropped, and the host is case-folded.
 * The path keeps its case: case-folding it could merge two repositories that
 * differ only by case on a case-sensitive host, and accidental sharing violates
 * the isolation invariant (ADR §5) more severely than splitting.
 *
 * Returns null when the input is not a recognized remote (empty text, a local
 * path, `file://`, unknown scheme, no repository path). The caller must treat
 * null as "no remote", never as a key.
 */
export function normalizeRemote(raw: string): string | null {
  const input = raw.trim();
  if (input === "") return null;
  // Absolute or home-relative paths are local checkouts, not remotes.
  if (input.startsWith("/") || input.startsWith(".") || input.startsWith("~")) return null;

  let host: string;
  let rawPath: string;
  const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(input);
  if (schemeMatch) {
    const scheme = schemeMatch[1]!.toLowerCase();
    if (!ACCEPTED_SCHEMES.has(scheme)) return null;
    const rest = input.slice(schemeMatch[0].length);
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    const authorityRaw = rest.slice(0, slash);
    rawPath = rest.slice(slash + 1);
    // Credentials live in userinfo. Use the last '@' in the authority so a
    // password containing '@' cannot leak the host into the key.
    const at = authorityRaw.lastIndexOf("@");
    let authority = at >= 0 ? authorityRaw.slice(at + 1) : authorityRaw;
    if (authority === "") return null;
    // A query, a fragment, a backslash or a control character in the authority
    // means the URL is not the remote it appears to be: `http://127.0.0.1:1#@
    // github.com/acme/app` has authority `127.0.0.1:1#@github.com` and would
    // otherwise fold into another repository's key (review H2). Refuse the
    // input instead of guessing which part was meant.
    if (/[\s?#\\\u0000-\u001f\u007f]/.test(authorityRaw)) return null;
    const portMatch = /^(.*?):(\d+)$/.exec(authority);
    if (portMatch && DEFAULT_PORTS[scheme] === portMatch[2]) authority = portMatch[1]!;
    host = authority;
  } else {
    // SCP-like form: [user@]host:path. Git splits at the FIRST ':' and takes
    // everything before it as [user@]host, so `evil.com:path@github.com:acme/app`
    // belongs to host `evil.com` and can never fold onto github.com (review H2).
    // The path is not inspected: a legitimate remote may contain '@' or ':' in
    // its path, and refusing it would silently re-key an existing repository
    // (an `a@b` path, or a local-only repository whose key would change).
    if (input.includes("://")) return null;
    const bracketed = /^(?:[^@/]+@)?\[([^\]\s]+)\]:(.+)$/.exec(input);
    if (bracketed) {
      host = `[${bracketed[1]}]`;
      rawPath = bracketed[2]!;
    } else {
      const colon = input.indexOf(":");
      if (colon < 0) return null;
      const authority = input.slice(0, colon);
      const at = authority.lastIndexOf("@");
      host = at >= 0 ? authority.slice(at + 1) : authority;
      rawPath = input.slice(colon + 1);
    }
    if (host === "" || rawPath === "") return null;
  }

  if (rawPath.includes("\\")) return null;
  rawPath = rawPath.split("?")[0]!.split("#")[0]!;
  let path = rawPath.replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (path.toLowerCase().endsWith(".git")) path = path.slice(0, -4);
  path = path.replace(/\/+$/, "");
  if (host === "" || /\s/.test(host) || path === "") return null;
  // A single-token host without a dot is text, not a remote ("origin:thing").
  if (!host.startsWith("[") && !host.includes(".") && !path.includes("/")) return null;

  return `${host.toLowerCase()}/${path}`;
}

/**
 * Deterministic local repository key for a repository with no usable remote
 * (ADR §9): the absolute Git common root.
 *
 * Documented limitation (ADR §9, must not be hidden by a heuristic): a
 * remote-less repository that is moved or independently cloned is *not*
 * recognizable as the same repository, because the key is the path. The
 * limitation is resolved by establishing a canonical remote, not by guessing.
 * A repository that later gains a remote therefore binds under the canonical
 * remote key; the earlier `local:` binding is not silently rewritten into it
 * (ADR §15 forbids silent relink), so the transition is an explicit
 * administrative repair while the repository has two visible bindings rather
 * than a silent share.
 */
export function localRepositoryKey(commonRoot: string): string {
  const trimmed = commonRoot.trim();
  if (trimmed === "") throw new Error("cannot derive a local repository identity from an empty path");
  if (!trimmed.startsWith("/")) {
    throw new Error(`local repository identity requires an absolute Git common root: ${trimmed}`);
  }
  const normalized = trimmed.replace(/\/+/g, "/").replace(/\/+$/, "");
  return `${LOCAL_KEY_PREFIX}${normalized === "" ? "/" : normalized}`;
}

/**
 * Pick the canonical remote that represents the repository (ADR §8, §13).
 *
 * A normalizable `origin` wins. With no `origin`, exactly one distinct
 * normalized key is used. Several distinct keys and no `origin` are ambiguous
 * local evidence: no alphabetically-guessed pick is made, because binding the
 * repository to a fork's identity would be an invented identity (ADR §98) and
 * could expose another repository's Issues (ADR §5). The call fails closed and
 * names the repair action.
 *
 * Remotes that normalize to the same key (HTTPS and SSH of one repository) are
 * not ambiguous.
 */
export function selectCanonicalRemote(remotes: ReadonlyArray<{ name?: string; url: string }>): string | null {
  const normalized = remotes
    .map((r) => ({ name: (r.name ?? "").trim(), key: normalizeRemote(r.url) }))
    .filter((r): r is { name: string; key: string } => r.key !== null);
  if (normalized.length === 0) return null;
  const origin = normalized.find((r) => r.name === "origin");
  if (origin) return origin.key;
  const keys = [...new Set(normalized.map((r) => r.key))].sort();
  if (keys.length === 1) return keys[0]!;
  throw new Error(
    `ambiguous canonical remote: ${keys.length} unrelated remotes (${keys.join(", ")}) and no 'origin'. ` +
      `Repair: configure 'origin' to name the canonical remote, or pass the canonical remote explicitly`,
  );
}

/**
 * Derive repository identity from observed repository facts: the canonical
 * remote when one exists, otherwise the Git common root. The caller owns
 * discovery (`git remote -v`, `git rev-parse --path-format=absolute
 * --git-common-dir`); this function owns the derivation and refuses to invent
 * identity when neither fact is available.
 */
export function deriveRepositoryIdentity(input: {
  commonRoot?: string | null;
  remotes?: ReadonlyArray<{ name?: string; url: string }>;
}): RepositoryIdentity {
  const canonicalRemote = selectCanonicalRemote(input.remotes ?? []);
  if (canonicalRemote !== null) {
    return { repositoryKey: canonicalRemote, canonicalRemote, local: false };
  }
  const commonRoot = (input.commonRoot ?? "").trim();
  if (commonRoot !== "") {
    return { repositoryKey: localRepositoryKey(commonRoot), canonicalRemote: null, local: true };
  }
  throw new Error(
    "cannot derive repository identity: no canonical remote and no Git common root were discovered",
  );
}

// --- deterministic Project identity (ADR §§11-12) ------------------------

function slugSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function slugFromSegments(segments: readonly string[]): string {
  const parts = segments.map(slugSegment).filter((p) => p !== "");
  // A basename with no alphanumeric character at all has no legible slug. The
  // documented last resort is the fixed token `repo` (deterministic and stable,
  // never random); the candidate walker keeps it from being shared with a real
  // repository named `repo`, and `prefixFromSlug` keeps the prefix legal.
  return parts.join("_") === "" ? "repo" : parts.join("_");
}

// Prefixes are uppercase alphanumeric starting with a letter (the Projects
// table constrains them). A compacted slug always satisfies that once a
// leading 'R' is added for digit-leading basenames.
function prefixFromSlug(slug: string): string {
  const compact = slug.replace(/_/g, "").toUpperCase();
  if (compact === "") return "REPO";
  return /^[A-Z]/.test(compact) ? compact : `R${compact}`;
}

// Key segments: for a remote key the host is first and the repository basename
// last; for a local key the absolute path segments are the identity.
function identitySegments(identity: RepositoryIdentity): string[] {
  const raw = identity.local ? identity.repositoryKey.slice(LOCAL_KEY_PREFIX.length) : identity.repositoryKey;
  return raw.split("/").filter((s) => s !== "");
}

/**
 * Deterministic, non-random Project identity candidates for a repository
 * (ADR §§11-12). The first candidate is the ordinary initialization identity;
 * the later candidates deterministically incorporate owner/path when the
 * basename-derived identity is already taken by a *different* repository.
 *
 * Documented collision algorithm:
 *
 * 1. Ordinary identity is the repository basename:
 *      github.com/xtrm-dev/xtrm      -> prj_xtrm / XTRM / xtrm
 *      github.com/xtrm-dev/specialists -> prj_specialists / SPECIALISTS / specialists
 * 2. When that id or prefix is already bound to another repository_key, the
 *    immediate owner segment is incorporated, then the full owner path, then
 *    the full path including host. Candidate order is fixed, so the result is
 *    a deterministic function of durable binding state. No random suffix is
 *    ever generated, and an established Project is never renamed to make room
 *    (ADR §12; see `RepositoryService.bindRepository`).
 * 3. If every candidate is taken, identity resolution fails closed with the
 *    repository key, the conflicting Project and a repair action (ADR §15).
 *
 * The policy is order-sensitive in exactly one way: the repository that binds
 * first keeps the basename-derived Project, and a later collision takes the
 * owner-qualified candidate. That is inherent to "never silently rename an
 * established Project" and is stable across machines because it depends only on
 * durable state, not on wall-clock or enumeration order.
 */
export function deriveProjectCandidates(identity: RepositoryIdentity): ProjectIdentity[] {
  const segments = identitySegments(identity);
  const basename = segments[segments.length - 1] ?? "repo";
  const name = basename === "" ? "repo" : basename;
  const ownerSegments = identity.local ? segments.slice(0, -1) : segments.slice(1, -1);
  const host = identity.local ? null : (segments[0] ?? null);

  const candidates: ProjectIdentity[] = [];
  const push = (slugSegments: readonly string[]): void => {
    const slug = slugFromSegments(slugSegments);
    const id = `prj_${slug}`;
    if (candidates.some((c) => c.id === id)) return;
    candidates.push({ id, prefix: prefixFromSlug(slug), name });
  };

  push([basename]);
  if (ownerSegments.length >= 1) push([ownerSegments[ownerSegments.length - 1]!, basename]);
  if (ownerSegments.length >= 2) push([...ownerSegments, basename]);
  if (host !== null) push([host, ...ownerSegments, basename]);
  return candidates;
}

/** The ordinary initialization identity: the first candidate (ADR §11). */
export function deriveProjectIdentity(identity: RepositoryIdentity): ProjectIdentity {
  return deriveProjectCandidates(identity)[0]!;
}

// --- base branch evidence (ADR §10) -------------------------------------

export interface BaseBranchEvidence {
  // Branch the remote HEAD points at (e.g. `git symbolic-ref refs/remotes/origin/HEAD`).
  remoteHead?: string | null;
  // Configured default/upstream reference, when the repository has one.
  configuredDefault?: string | null;
  // The branch the command ran from; null when detached or unknown.
  currentBranch?: string | null;
  // Branches that exist locally.
  localBranches?: readonly string[];
}

const CONVENTIONAL_BASE_BRANCHES = ["main", "master"] as const;

// Git surfaces the same fact in several mechanical spellings; reducing them is
// deterministic, not a guess. Feature-branch names are never produced here.
function bareBranchName(value: string): string {
  let s = value.trim();
  const arrow = s.lastIndexOf("->");
  if (arrow >= 0) s = s.slice(arrow + 2).trim();
  s = s.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
  return s;
}

/**
 * Detect the repository's canonical base branch from deterministic evidence
 * (ADR §10), in this order:
 *
 * 1. remote HEAD (e.g. `origin/HEAD -> main`);
 * 2. a configured default/upstream reference;
 * 3. an unambiguous conventional default branch (`main` or `master`);
 * 4. documented deterministic fallback: `main`, then `master`, when both exist;
 *    otherwise null.
 *
 * `currentBranch` is accepted but never used as a base: running `sb init` from
 * `feature/foo` must not make that branch the repository base. A detached
 * worktree (currentBranch null) stays valid because the evidence is
 * branch-independent. Unknown returns null and is stored absent (ADR §98),
 * never invented.
 */
export function deriveBaseBranch(evidence: BaseBranchEvidence): string | null {
  const clean = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed === "" ? null : bareBranchName(trimmed);
  };
  const remoteHead = clean(evidence.remoteHead);
  if (remoteHead !== null) return remoteHead;
  const configured = clean(evidence.configuredDefault);
  if (configured !== null) return configured;
  const branches = (evidence.localBranches ?? []).map((b) => b.trim()).filter((b) => b !== "");
  const conventional = CONVENTIONAL_BASE_BRANCHES.filter((b) => branches.includes(b));
  if (conventional.length >= 1) return conventional[0]!; // `main` preferred when both exist
  return null;
}
