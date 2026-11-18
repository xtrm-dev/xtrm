import {
  JiraError,
  type JiraAdapter,
  type JiraBinding,
  type JiraBindingsReason,
  type JiraIssue,
  type JiraLinks,
  type JiraMissingReason,
  type JiraSearchPage,
} from "./types.ts";

// Wire shapes of the read-only Jira bridge (server/jira-api.ts). Only the fields read here; the
// bridge owns the Jira host, the credential and the project restriction, so no URL is built from
// a component or a key.

export interface WireJiraBinding {
  repository: string;
  configured: boolean;
  reason: string | null;
  resolvedBy: string;
  pmProject: string | null;
  substrateProject: string | null;
  site: string | null;
  project: string | null;
  boardId: string | null;
  tokenFile: string | null;
  credentialPresent: boolean;
}

export interface WireJiraIssue {
  key: string;
  summary: string | null;
  status: string | null;
  assignee: string | null;
  url: string;
  syncState: string | null;
  issueRef: string | null;
  bindingsAvailable?: boolean;
}

export interface WireIssueBody {
  ok: boolean;
  issue?: WireJiraIssue;
  bindingsAvailable?: boolean;
  bindingsReason?: string | null;
  cachedAt?: string | null;
}

export interface WireSearchBody {
  ok: boolean;
  issues?: WireJiraIssue[];
  truncated?: boolean;
  bindingsAvailable?: boolean;
  bindingsReason?: string | null;
  cachedAt?: string | null;
}

export interface WireLinksBody {
  ok: boolean;
  links?: WireJiraIssue[];
  bindingsAvailable?: boolean;
  bindingsReason?: string | null;
  cachedAt?: string | null;
}

export interface WireBindingBody {
  ok: boolean;
  binding?: WireJiraBinding;
}

const RESOLVED_BY: readonly JiraBinding["resolvedBy"][] = ["explicit", "env", "repo_slug", "repo_name", "none"];
const MISSING_REASONS: readonly JiraMissingReason[] = ["config_absent", "repo_not_bound", "jira_not_configured", "jira_invalid_config"];
const BINDINGS_REASONS: readonly JiraBindingsReason[] = ["sb_project_missing", "sb_unavailable", "sb_truncated"];

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

const resolvedByOf = (value: unknown): JiraBinding["resolvedBy"] =>
  typeof value === "string" && (RESOLVED_BY as readonly string[]).includes(value) ? (value as JiraBinding["resolvedBy"]) : "none";

const missingReasonOf = (value: unknown): JiraMissingReason | null =>
  typeof value === "string" && (MISSING_REASONS as readonly string[]).includes(value) ? (value as JiraMissingReason) : null;

/** A join reason the bridge did not state is "unavailable", never "complete". */
const bindingsReasonOf = (value: unknown): JiraBindingsReason | null =>
  typeof value === "string" && (BINDINGS_REASONS as readonly string[]).includes(value) ? (value as JiraBindingsReason) : null;

export function mapBinding(wire: WireJiraBinding): JiraBinding {
  return {
    repository: wire.repository,
    configured: wire.configured === true,
    reason: wire.configured === true ? null : missingReasonOf(wire.reason),
    resolvedBy: resolvedByOf(wire.resolvedBy),
    pmProject: text(wire.pmProject),
    substrateProject: text(wire.substrateProject),
    site: text(wire.site),
    project: text(wire.project),
    boardId: text(wire.boardId),
    tokenFile: text(wire.tokenFile),
    credentialPresent: wire.credentialPresent === true,
  };
}

/** One wire issue -> the typed view. Missing fields stay null; nothing is invented. */
export function mapIssue(wire: WireJiraIssue): JiraIssue {
  return {
    key: wire.key,
    summary: text(wire.summary),
    status: text(wire.status),
    assignee: text(wire.assignee),
    url: text(wire.url) ?? "",
    syncState: text(wire.syncState),
    issueRef: text(wire.issueRef),
    // A wire row without the flag is unknown, not "no binding": only the bridge can say it knows.
    bindingsAvailable: wire.bindingsAvailable === true,
  };
}

/**
 * `syncState` is provenance from Substrate. An unknown value is preserved as carried rather than
 * coerced to a known one; the UI renders it neutrally (ADR-002 §3 mapping rules).
 */
export const isKnownSyncState = (value: string | null): boolean => value !== null && (["in_sync", "pending", "drift", "uncertain"] as readonly string[]).includes(value);

export const JIRA_BASE = "/xtrm-api/jira";

export interface LiveJiraOptions {
  fetchImpl?: typeof fetch;
  basePath?: string;
}

/**
 * Live adapter: reads only through the bridge (same origin, no credential here). Every failure is
 * a typed `JiraError`; no message carries a credential, an upstream URL, or a response body.
 */
export function createJiraLiveAdapter(opts: LiveJiraOptions = {}): JiraAdapter {
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.basePath ?? JIRA_BASE;

  const get = async (route: string, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> => {
    const query = new URLSearchParams(params);
    let response: Response;
    try {
      response = await doFetch(`${base}${route}?${query.toString()}`);
    } catch {
      throw new JiraError("upstream", "jira bridge unreachable");
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      throw new JiraError("malformed", "jira bridge returned a non-JSON body", response.status);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new JiraError("malformed", "jira bridge returned an unexpected body", response.status);
    }
    return { status: response.status, body: parsed as Record<string, unknown> };
  };

  /** One typed error per bridge status; the message never echoes the body. */
  const fail = (status: number, body: Record<string, unknown>, route: "binding" | "issue" | "search" | "links"): JiraError => {
    if (status === 400) return new JiraError("bad_request", "jira request rejected", status);
    if (status === 403) return new JiraError("forbidden", "jira key is outside the bound project", status);
    if (status === 404) {
      if (body["configured"] === false) return new JiraError("unbound", "repository has no jira binding", status);
      if (route === "issue") return new JiraError("not_found", "jira issue not found", status);
      return new JiraError("upstream", "jira read failed", status);
    }
    if (status === 503) {
      // Unusable operator config is not a credential fault: the two must read differently.
      if (body["reason"] === "jira_invalid_config") return new JiraError("config", "jira binding config is unusable", status);
      return new JiraError("credential", "jira credential unavailable", status);
    }
    return new JiraError("upstream", "jira read failed", status);
  };

  return {
    source: "live",

    async binding(repository) {
      const { status, body } = await get("/binding", { repo: repository });
      if (status === 200) return mapBinding(body["binding"] as WireJiraBinding);
      if (status === 404 && body["configured"] === false) {
        return {
          repository,
          configured: false,
          reason: missingReasonOf(body["reason"]),
          resolvedBy: resolvedByOf(body["resolvedBy"]),
          pmProject: null,
          substrateProject: null,
          site: null,
          project: null,
          boardId: null,
          tokenFile: null,
          credentialPresent: false,
        };
      }
      throw fail(status, body, "binding");
    },

    async issue(repository, key) {
      const { status, body } = await get("/issue", { repo: repository, key });
      if (status !== 200) throw fail(status, body, "issue");
      const issue = (body as unknown as WireIssueBody).issue;
      if (!issue) throw new JiraError("malformed", "jira bridge returned no issue", status);
      return mapIssue(issue);
    },

    async search(repository, searchOpts) {
      const params: Record<string, string> = { repo: repository };
      if (searchOpts?.jql) params["jql"] = searchOpts.jql;
      const { status, body } = await get("/search", params);
      if (status !== 200) throw fail(status, body, "search");
      const wire = body as unknown as WireSearchBody;
      if (!Array.isArray(wire.issues)) throw new JiraError("malformed", "jira bridge returned no search page", status);
      return {
        issues: wire.issues.map(mapIssue),
        truncated: wire.truncated === true,
        bindingsAvailable: wire.bindingsAvailable === true,
        bindingsReason: bindingsReasonOf(wire.bindingsReason),
        cachedAt: text(wire.cachedAt),
      };
    },

    async links(repository, keys) {
      const { status, body } = await get("/links", { repo: repository, keys: keys.join(",") });
      if (status !== 200) throw fail(status, body, "links");
      const wire = body as unknown as WireLinksBody;
      if (!Array.isArray(wire.links)) throw new JiraError("malformed", "jira bridge returned no links", status);
      return {
        links: wire.links.map(mapIssue),
        bindingsAvailable: wire.bindingsAvailable === true,
        bindingsReason: bindingsReasonOf(wire.bindingsReason),
        cachedAt: text(wire.cachedAt),
      };
    },
  };
}

export const liveJira: JiraAdapter = createJiraLiveAdapter();
