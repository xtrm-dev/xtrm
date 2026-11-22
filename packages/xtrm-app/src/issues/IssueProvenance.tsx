import type { ReactNode } from "react";
import type { ArtifactRecord, Closure, IssueDetail } from "../adapters/index.tsx";
import { parseProvenancePr } from "../github/pr.ts";
import { ReferenceChip } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Card } from "../ui/card.tsx";
import { Icon } from "../ui/icon.tsx";
import { Fields, PART_LABEL_COLUMN } from "../ui/drawer.tsx";
import { SectionHeader } from "../ui/section.tsx";
import { StatusDot, cx } from "../ui/primitives.tsx";
import { IdValue, Timestamp } from "./IssueJournal.tsx";

const None = ({ children = "None" }: { children?: ReactNode }) => <span className="text-ink-faint">{children}</span>;

/** A provenance group: the shared section header (XTRM-987) at the level this group already held. */
function Group({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <SectionHeader title={title} count={count} inset="none" level={4} />
      {children}
    </section>
  );
}

/**
 * Compact label/value grid; wraps inside a narrow inspector. It is `Fields` with the issue part's
 * step (XTRM-971): the local `<dl>` this replaced was a fifth hand-rolled copy of the same grid, and
 * `IssueView` declared the same 6.5rem separately, so the two agreed by coincidence rather than by
 * rule. The only visible difference is the primitive's `gap-y-1.5` in place of `gap-y-1`.
 */
function KV({ rows }: { rows: Array<[string, ReactNode] | false | null> }) {
  return <Fields labelWidth={PART_LABEL_COLUMN} rows={rows.filter((r): r is [string, ReactNode] => !!r)} />;
}

const id = (label: string, value: string | null) => (value ? <IdValue label={label} value={value} /> : <None>Not recorded</None>);
const hash = (value: string | null) => (value ? <IdValue label="contract hash" value={value.slice(0, 12)} /> : <None>Not recorded</None>);

function Artifacts({ items }: { items: ArtifactRecord[] }) {
  return (
    <span className="flex flex-col gap-0.5">
      {items.map((a, i) => (
        <span key={`${a.kind}-${a.value}-${i}`} className={cx("flex min-w-0 items-center gap-1.5 text-xs", a.superseded && "line-through opacity-60")}>
          <span className="shrink-0 rounded-sm bg-control px-1 text-ink-muted">{a.kind}</span>
          <span className="min-w-0 truncate font-mono text-ink-muted" title={a.value}>
            {a.value}
          </span>
          {a.provider && <span className="text-ink-faint">{a.provider}</span>}
        </span>
      ))}
    </span>
  );
}

export function commitUrl(repoFullName: string, sha: string) {
  return `https://github.com/${repoFullName}/commit/${sha}`;
}

function CommitLink({ sha }: { sha: string }) {
  const { repo } = useShell();
  return (
    <a href={commitUrl(repo.fullName, sha)} target="_blank" rel="noreferrer" title={sha} className="inline-flex items-center gap-1 font-mono text-xs text-accent-ink hover:underline">
      {sha.slice(0, 10)}
      <Icon name="external" size="xs" />
    </a>
  );
}

export function ClosureCard({ closure, issue }: { closure: Closure; issue: IssueDetail }) {
  if (!closure.closed) return null;
  const stale = closure.revision != null && closure.revision < issue.revision;
  return (
    <Card data-testid="closure-card" className="bg-deep/40">
      <div className="flex items-center gap-2 text-sm">
        <StatusDot tone="done" label="closed" />
        <span className="font-medium text-ink">Closed</span>
        <span className="text-ink-muted">{closure.outcome ?? issue.lifecycle}</span>
        <Timestamp at={closure.closedAt} className="ml-auto text-xs text-ink-faint" />
      </div>
      {stale && (
        <p data-testid="closure-stale" className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Icon name="alert" size="xs" className="shrink-0" />
          Closed against contract revision {closure.revision}; the issue is now at revision {issue.revision}.
        </p>
      )}
      <KV
        rows={[
          ["Reason", closure.reason ?? <None>No reason recorded</None>],
          ["Actor", id("actor", closure.actor)],
          ["Session", id("session", closure.session)],
          ["Revision", closure.revision != null ? <span className="tabular">rev {closure.revision}</span> : <None>Not recorded</None>],
          ["Contract", hash(closure.contractHash)],
          closure.closureId ? ["Closure id", id("closure id", closure.closureId)] : false,
        ]}
      />
    </Card>
  );
}

export function ProvenanceTab({ issue, onJumpToJournal }: { issue: IssueDetail; onJumpToJournal: (sequence: number) => void }) {
  const p = issue.provenance;
  const { repo } = useShell();
  const a = p.attestation;
  const prRefs = p.prs.map((raw) => ({ raw, ref: parseProvenancePr(raw, repo.fullName) }));
  const claims = [...p.claims].sort((x, y) => (y.acquiredAt ?? 0) - (x.acquiredAt ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <Group title="Attestation">
        {a ? (
          <Card data-testid="attestation-card">
            <KV
              rows={[
                ["Outcome", <span className={a.outcome === "ready" ? "text-accent-ink" : "text-ink"}>{a.outcome || "—"}</span>],
                ["Policy", a.policy || <None>Not recorded</None>],
                ["Attested by", id("attested by", a.attestedBy || null)],
                ["Attested", <Timestamp at={a.createdAt || null} />],
                ["Revision", a.revision != null ? <span className="tabular">rev {a.revision}</span> : <None>Not recorded</None>],
                ["Contract", hash(a.contractHash)],
                ["Evidence", a.evidenceRefs.length ? <Artifacts items={a.evidenceRefs.map((value) => ({ kind: "ref", value, provider: null, superseded: false }))} /> : <None />],
                [
                  "Blocking gaps",
                  a.blockingGaps.length ? (
                    <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
                      {a.blockingGaps.map((g) => (
                        <li key={g}>{g}</li>
                      ))}
                    </ul>
                  ) : (
                    <None />
                  ),
                ],
              ]}
            />
          </Card>
        ) : (
          <None>Not attested</None>
        )}
      </Group>

      <Group title="Claims" count={claims.length}>
        {claims.length ? (
          <ol className="flex flex-col gap-1.5">
            {claims.map((c, i) => {
              const current = c.releasedAt == null && (c.expiresAt == null || c.expiresAt > Date.now());
              return (
                <li key={`${c.holder}-${c.generation}-${i}`} data-testid="claim-row">
                  <Card>
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                      <StatusDot tone={current ? "active" : "neutral"} label={current ? "current" : "released"} />
                      <IdValue label="holder" value={c.holder} className="text-sm text-ink" />
                      <span className="ml-auto shrink-0 text-xs text-ink-faint">{current ? "current" : c.releasedAt != null ? "released" : "expired"}</span>
                    </div>
                    <KV
                      rows={[
                        ["Activation", id("activation", c.activationId)],
                        ["Acquired", <Timestamp at={c.acquiredAt} />],
                        ["Expires", <Timestamp at={c.expiresAt} />],
                        ["Released", c.releasedAt != null ? <Timestamp at={c.releasedAt} /> : <None>Not released</None>],
                        ["Generation", c.generation != null ? <span className="tabular">{c.generation}</span> : <None>Not recorded</None>],
                      ]}
                    />
                  </Card>
                </li>
              );
            })}
          </ol>
        ) : (
          <None>No claims recorded</None>
        )}
      </Group>

      <Group title="Execution bindings" count={p.bindings.length}>
        {p.bindings.length ? (
          p.bindings.map((b) => (
            <Card key={b.id} data-testid="binding-row">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="min-w-0 truncate text-ink">{b.participantId ?? "Unnamed actor"}</span>
                <Timestamp at={b.createdAt} className="ml-auto shrink-0 text-xs text-ink-faint" />
              </div>
              <KV
                rows={[
                  ["Activation", id("activation", b.activationId)],
                  ["Attempt", id("attempt", b.attemptId)],
                  ["Session", id("session", b.sessionId)],
                  ["Workspace", id("workspace", b.workspace)],
                  ["Base commit", b.baseCommit ? <CommitLink sha={b.baseCommit} /> : <None>Not recorded</None>],
                  ["Binding", id("binding", b.id)],
                ]}
              />
            </Card>
          ))
        ) : (
          <None>No execution bindings</None>
        )}
      </Group>

      <Group title="Receipts" count={p.receipts.length}>
        {p.receipts.length ? (
          p.receipts.map((r) => (
            <Card key={r.id} data-testid="receipt-row">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <IdValue label="receipt" value={r.id} />
                <span className="ml-auto shrink-0 text-xs text-ink-faint">{r.finalizedAt != null ? "finalized" : "open"}</span>
              </div>
              <KV
                rows={[
                  ["Commit", r.commitSha ? <CommitLink sha={r.commitSha} /> : <None>Not linked</None>],
                  [
                    "Checkpoint",
                    r.checkpointSequence != null ? (
                      <button type="button" onClick={() => onJumpToJournal(r.checkpointSequence!)} className="rounded-sm text-sm text-accent-ink outline-none hover:underline focus-visible:underline">
                        Journal #{r.checkpointSequence}
                      </button>
                    ) : r.checkpointId ? (
                      <IdValue label="checkpoint" value={r.checkpointId} />
                    ) : (
                      <None>Not linked</None>
                    ),
                  ],
                  ["Binding", id("binding", r.bindingId)],
                  ["Revision", r.revision != null ? <span className="tabular">rev {r.revision}</span> : <None>Not recorded</None>],
                  ["Created", <Timestamp at={r.createdAt} />],
                  r.validationRefs.length ? ["Validation", <Artifacts items={r.validationRefs} />] : ["Validation", <None />],
                  r.artifacts.length ? ["Artifacts", <Artifacts items={r.artifacts} />] : ["Artifacts", <None />],
                ]}
              />
            </Card>
          ))
        ) : (
          <None>No receipts</None>
        )}
      </Group>

      <Group title="Checkpoints" count={p.checkpoints.length}>
        {p.checkpoints.length ? (
          <ul className="flex flex-col gap-1">
            {p.checkpoints.map((c) => (
              <li key={c.entryId} className="flex min-w-0 items-center gap-2 text-sm">
                <button type="button" onClick={() => onJumpToJournal(c.sequence)} className="shrink-0 rounded-sm text-accent-ink outline-none hover:underline focus-visible:underline">
                  #{c.sequence}
                </button>
                <span className="shrink-0 text-xs text-ink-faint">{c.kind}</span>
                <span className="min-w-0 truncate text-ink-muted">{c.summary ?? "No summary"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <None>No checkpoints</None>
        )}
      </Group>

      <Group title="Commits" count={p.commits.length}>
        {p.commits.length ? (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {p.commits.map((sha) => (
              <CommitLink key={sha} sha={sha} />
            ))}
          </span>
        ) : (
          <None />
        )}
      </Group>

      <Group title="Pull requests" count={prRefs.length}>
        {prRefs.length ? (
          <span className="flex flex-wrap items-center gap-0.5">
            {prRefs.map(({ raw, ref }) => (ref ? <ReferenceChip key={raw} reference={ref} /> : <span key={raw} className="font-mono text-xs text-ink-muted">{raw}</span>))}
          </span>
        ) : (
          <None />
        )}
      </Group>

      <Group title="External bindings" count={p.externalBindings.length}>
        {p.externalBindings.length ? (
          <ul className="flex flex-col gap-1">
            {p.externalBindings.map((e) => (
              <li key={`${e.provider}-${e.scope}-${e.remoteId}`} className="flex min-w-0 items-center gap-2 text-sm">
                <span className="shrink-0 rounded-sm bg-control px-1.5 text-xs text-ink-muted">{e.provider}</span>
                <span className="min-w-0 truncate text-ink">
                  {e.scope} · {e.remoteId}
                </span>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer" className="ml-auto shrink-0 text-accent-ink" aria-label={`Open ${e.provider} ${e.remoteId}`}>
                    <Icon name="external" size="xs" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <None />
        )}
      </Group>
    </div>
  );
}
