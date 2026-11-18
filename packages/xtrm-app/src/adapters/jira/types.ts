import type { DataSource } from "../types.ts";

// Typed view models for the Jira bridge (server/jira-api.ts). UI components depend on these,
// never on the wire shapes in live.ts. ADR-002 §3 (JiraIssue) and §D5 (Substrate owns the link).

export type JiraMissingReason = "config_absent" | "repo_not_bound" | "jira_not_configured" | "jira_invalid_config";

/** Why a join could not answer for a key; `null` means the read was complete and a null state is real. */
export type JiraBindingsReason = "sb_project_missing" | "sb_unavailable" | "sb_truncated";

/** Substrate `external_bindings.sync_state` (ADR-002 §D5); displayed, never inferred. */
export const JIRA_SYNC_STATES = ["in_sync", "pending", "drift", "uncertain"] as const;

export type JiraSyncState = (typeof JIRA_SYNC_STATES)[number];

/** One repository's Jira binding. The token path is named; its value never crosses this boundary. */
export interface JiraBinding {
  repository: string;
  configured: boolean;
  reason: JiraMissingReason | null;
  resolvedBy: "explicit" | "env" | "repo_slug" | "repo_name" | "none";
  pmProject: string | null;
  substrateProject: string | null;
  site: string | null;
  project: string | null;
  boardId: string | null;
  tokenFile: string | null;
  credentialPresent: boolean;
}

/** A Jira issue joined with its durable Substrate identity, when the project has one. */
export interface JiraIssue {
  key: string;
  summary: string | null;
  status: string | null;
  assignee: string | null;
  /** Browse URL; always present because the binding supplies the site. */
  url: string;
  /** `null` when no Substrate binding exists, or when the bindings read was unavailable. */
  syncState: string | null;
  /** The owning Substrate Issue reference (`XTRM-816`), `null` when unbound. */
  issueRef: string | null;
  /**
   * False when this row's Substrate identity is unknown (the join failed, or this key fell past a
   * truncated page): `syncState`/`issueRef` are then null because nobody could read them, never
   * because the issue is unbound.
   */
  bindingsAvailable: boolean;
}

export interface JiraSearchPage {
  issues: JiraIssue[];
  /** More issues matched than this page carries; the surface must say so, never silently cap. */
  truncated: boolean;
  /** False when the Substrate join could not answer for every issue in this page. */
  bindingsAvailable: boolean;
  /** Why the join is incomplete; `null` when it was complete. */
  bindingsReason: JiraBindingsReason | null;
  /** When the upstream data was fetched (bridged cache entry time), never "now". */
  cachedAt: string | null;
}

export interface JiraLinks {
  links: JiraIssue[];
  /**
   * False when the Substrate bindings read failed or was truncated: `syncState`/`issueRef` are then
   * null because they are unknown, not because the issues are unbound.
   */
  bindingsAvailable: boolean;
  /** Why the join is incomplete; `null` when it was complete. */
  bindingsReason: JiraBindingsReason | null;
  cachedAt: string | null;
}

export type JiraErrorKind = "bad_request" | "unbound" | "forbidden" | "credential" | "config" | "not_found" | "upstream" | "malformed";

/** A typed bridge failure. The message never carries a credential, an upstream URL, or a body. */
export class JiraError extends Error {
  readonly kind: JiraErrorKind;
  readonly status: number | null;

  constructor(kind: JiraErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "JiraError";
    this.kind = kind;
    this.status = status;
  }
}

export interface JiraAdapter {
  readonly source: DataSource;
  /** The resolved Jira binding for one repository; an unbound repository is reported, not thrown. */
  binding(repository: string): Promise<JiraBinding>;
  /** One issue by key. A key outside the bound project is a `forbidden` error, never a read. */
  issue(repository: string, key: string): Promise<JiraIssue>;
  /** Bounded search inside the bound project; `jql` may only restate the project filter. */
  search(repository: string, opts?: { jql?: string }): Promise<JiraSearchPage>;
  /** Resolve several keys (max 50) with their Substrate links; no key may leave the bound project. */
  links(repository: string, keys: string[]): Promise<JiraLinks>;
}
