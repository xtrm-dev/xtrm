import { ReferenceChip } from "../refs/references.tsx";
import { cx } from "../ui/primitives.tsx";
import type { IssueDetail, LinkEvent, PullLink } from "../adapters/types.ts";

const HEADING = "text-[0.68rem] font-medium uppercase tracking-wide text-ink-faint";

function GateBadge({ gate }: { gate: IssueDetail["linkGate"] }) {
  const pass = gate.manual.verdict === "pass";
  return (
    <span
      title={gate.manual.codes.length > 0 ? gate.manual.codes.join(", ") : "delivery evidence present"}
      className={cx("rounded px-1.5 py-0.5 text-[0.68rem] leading-4", pass ? "bg-hover text-ink-muted" : "bg-danger/12 text-danger")}
    >
      gate {gate.manual.verdict}
    </span>
  );
}

function LinkRow({ link }: { link: PullLink }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
      <ReferenceChip reference={{ kind: "pr", ref: `${link.repository}#${link.number}` }} fallback={`${link.repository}#${link.number}`} />
      <span className="text-ink-faint">{link.sources.join(" · ")}</span>
      {link.commits.length > 0 && <span className="text-ink-faint">{link.commits.length} commit{link.commits.length === 1 ? "" : "s"}</span>}
      {link.alsoMentioned && <span className="text-ink-faint">also mentioned</span>}
    </div>
  );
}

/** The issue page's PULL REQUESTS block. Order is the service's: created_from
 * first, then mentioned; the component never re-sorts. */
export function PullRequestsBlock({ links, gate }: { links: PullLink[]; gate: IssueDetail["linkGate"] }) {
  if (links.length === 0) return null;
  const created = links.filter((l) => l.relation === "created_from");
  const mentioned = links.filter((l) => l.relation === "mentioned");
  return (
    <section aria-label="Pull requests" className="flex flex-col gap-2 border-t border-border-muted pt-4">
      <div className="flex items-center gap-2">
        <span className={HEADING}>Pull requests</span>
        <GateBadge gate={gate} />
      </div>
      {[["Created from", created], ["Mentioned", mentioned]].map(([label, rows]) =>
        (rows as PullLink[]).length === 0 ? null : (
          <div key={label as string} className="flex flex-col gap-1">
            <span className="text-[0.68rem] text-ink-faint">{label as string}</span>
            {(rows as PullLink[]).map((link) => <LinkRow key={link.id} link={link} />)}
          </div>
        ),
      )}
    </section>
  );
}

/** PR events in the activity timeline; findings and gate warnings read as warnings. */
export function LinkEvents({ events }: { events: LinkEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol aria-label="Pull-request events" className="flex flex-col gap-1 border-b border-border-subtle pb-3">
      {events.map((event) => {
        const warning = event.type === "provenance.link_finding" || event.type === "provenance.link_gate_warned";
        const code = typeof event.payload["code"] === "string" ? event.payload["code"] : null;
        const repository = typeof event.payload["repository"] === "string" ? event.payload["repository"] : null;
        const number = typeof event.payload["number"] === "number" ? event.payload["number"] : null;
        return (
          <li key={event.eventId} className={cx("flex flex-wrap items-center gap-1.5 text-xs", warning ? "text-accent-ink" : "text-ink-muted")}>
            <span className="tabular text-ink-faint">{new Date(event.createdAt).toLocaleDateString()}</span>
            <span>{event.type.replace("provenance.", "").replaceAll("_", " ")}</span>
            {repository && number !== null && <span className="text-ink-faint">{repository}#{number}</span>}
            {code && <span className="text-ink-faint">{code}</span>}
          </li>
        );
      })}
    </ol>
  );
}
