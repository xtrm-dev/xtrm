// TypeBox schemas for the shared tool surface (XTRM-674). Keys and docs come
// from integrations/tool-surface.ts; MCP builds the same shapes with zod.

import { Type, type TSchema } from "@earendil-works/pi-ai";
import {
  CLAIM_OPS,
  CLOSURE_OUTCOMES,
  ISSUE_LIST_STATUSES,
  WRITABLE_JOURNAL_KINDS,
  JOURNAL_READ_MODES,
  paramDoc,
  type ToolName,
} from "../tool-surface.ts";

const d = (tool: ToolName, key: string) => ({ description: paramDoc(tool, key) });
const str = (tool: ToolName, key: string) => Type.String(d(tool, key));
const int = (tool: ToolName, key: string) => Type.Integer(d(tool, key));
const strings = (tool: ToolName, key: string) => Type.Array(Type.String(), d(tool, key));
const object = (tool: ToolName, key: string) => Type.Record(Type.String(), Type.Unknown(), d(tool, key));
const literals = <T extends readonly string[]>(values: T, tool: ToolName, key: string) =>
  Type.Union(values.map((v) => Type.Literal(v)), d(tool, key));
const maybe = Type.Optional;

export const PI_PARAMETERS: Record<ToolName, TSchema> = {
  issue_get: Type.Object({ ref: str("issue_get", "ref") }),
  issue_list: Type.Object({
    project: maybe(str("issue_list", "project")),
    status: maybe(literals(ISSUE_LIST_STATUSES, "issue_list", "status")),
    query: maybe(str("issue_list", "query")),
    kind: maybe(str("issue_list", "kind")),
    limit: maybe(int("issue_list", "limit")),
    claimedBy: maybe(str("issue_list", "claimedBy")),
  }),
  issue_claim: Type.Object({
    ref: str("issue_claim", "ref"),
    op: maybe(literals(CLAIM_OPS, "issue_claim", "op")),
    holder: maybe(str("issue_claim", "holder")),
    ttlMs: maybe(int("issue_claim", "ttlMs")),
    activationId: maybe(str("issue_claim", "activationId")),
  }),
  issue_update: Type.Object({
    ref: str("issue_update", "ref"),
    title: maybe(str("issue_update", "title")),
    priority: maybe(int("issue_update", "priority")),
    contract: maybe(object("issue_update", "contract")),
  }),
  issue_close: Type.Object({
    ref: str("issue_close", "ref"),
    outcome: literals(CLOSURE_OUTCOMES, "issue_close", "outcome"),
    reason: str("issue_close", "reason"),
    journalResultRefs: maybe(strings("issue_close", "journalResultRefs")),
    validationRefs: maybe(strings("issue_close", "validationRefs")),
    receiptRefs: maybe(strings("issue_close", "receiptRefs")),
    artifactRefs: maybe(strings("issue_close", "artifactRefs")),
    participant: maybe(str("issue_close", "participant")),
  }),
  journal_append: Type.Object({
    ref: str("journal_append", "ref"),
    kind: literals(WRITABLE_JOURNAL_KINDS, "journal_append", "kind"),
    summary: maybe(str("journal_append", "summary")),
    summaryFile: maybe(str("journal_append", "summaryFile")),
    next: maybe(strings("journal_append", "next")),
    details: maybe(object("journal_append", "details")),
    result: maybe(object("journal_append", "result")),
  }),
  journal_read: Type.Object({
    ref: str("journal_read", "ref"),
    mode: literals(JOURNAL_READ_MODES, "journal_read", "mode"),
    kind: maybe(str("journal_read", "kind")),
    cursor: maybe(int("journal_read", "cursor")),
    limit: maybe(int("journal_read", "limit")),
  }),
  resume_capsule: Type.Object({ ref: str("resume_capsule", "ref") }),
  provenance: Type.Object({
    ref: maybe(str("provenance", "ref")),
    sessionId: maybe(str("provenance", "sessionId")),
    activationId: maybe(str("provenance", "activationId")),
  }),
};
