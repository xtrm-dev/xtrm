import { useQuery } from "@tanstack/react-query";
import { useAdapters, type AgentRef } from "../adapters/index.tsx";
import { useGo } from "../shell/ContextSidebar.tsx";
import { ContentPanel, EmptyState, LoadingState, StatusDot, relativeTime } from "../ui/primitives.tsx";
import { AgentRefChip } from "./RefChip.tsx";
import { ContextMeter, REF_LABEL, STATE_LABEL, STATE_TONE, contextPercent, shortModel } from "./meta.tsx";
import { useAgentSession } from "./queries.ts";

function Eyebrow({ children }: { children: string }) {
  return <p className="text-[0.65rem] font-medium tracking-wide text-ink-faint uppercase">{children}</p>;
}

/** Agent presence in the drawer; work happens in the Agent surface (PRD §7.5). */
export function SessionPanel({ id }: { id: string }) {
  const session = useAgentSession(id);
  const go = useGo();
  if (session.isPending) return <LoadingState rows={4} label="Loading session" />;
  const s = session.data;
  if (!s) return <EmptyState icon="agent" title="Session not found">The agent host does not know session {id}.</EmptyState>;
  const recent = [...s.frames].reverse().slice(0, 5);
  return (
    <div className="flex flex-col gap-5 px-5 py-4" data-testid="session-panel">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Session</Eyebrow>
        <div className="flex items-center gap-2">
          <StatusDot tone={STATE_TONE[s.state]} label={STATE_LABEL[s.state]} />
          <h2 className="truncate text-base font-medium text-ink">{s.name}</h2>
          <button
            type="button"
            onClick={() => go(`/agent/${s.id}`)}
            className="ml-auto flex h-7 shrink-0 items-center rounded-md border border-border-muted px-2 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong"
          >
            Open session
          </button>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
          <span>{[STATE_LABEL[s.state], s.role, shortModel(s.model)].filter(Boolean).join(" · ")}</span>
          <ContextMeter percent={contextPercent(s)} />
          {s.workRef && <AgentRefChip reference={{ kind: "issue", ref: s.workRef }} />}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <Eyebrow>Recent frames</Eyebrow>
        <ol className="flex flex-col">
          {recent.map((f) => (
            <li key={f.id} className="flex h-8 min-w-0 items-center gap-2 text-sm">
              <span className="w-5 shrink-0 text-xs text-ink-faint tabular">{f.index}</span>
              <span className="truncate text-ink">{f.title}</span>
              <span className="ml-auto shrink-0 text-xs text-ink-faint tabular">{relativeTime(f.startedAt)}</span>
            </li>
          ))}
        </ol>
      </div>
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        {[
          ["Cwd", s.cwd],
          ["Branch", s.branch],
          ["tmux", s.tmux],
          ["Parent", s.parentId],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-faint">{k}</dt>
              <dd className="truncate font-mono text-ink-muted">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

/** Host-resolved references (commit, file): bounded preview, never the whole artifact (PRD §36.6). */
export function HostRefPanel({ reference }: { reference: AgentRef }) {
  const { agent } = useAdapters();
  const q = useQuery({ queryKey: ["agent", "resolve", reference.kind, reference.ref], queryFn: () => agent.resolveReference(reference) });
  if (q.isPending) return <LoadingState rows={3} label="Resolving reference" />;
  if (!q.data) return <EmptyState icon="alert" title="Unresolved reference">{`@${reference.kind}:${reference.ref} does not resolve on the agent host.`}</EmptyState>;
  return (
    <div className="flex flex-col gap-3 px-5 py-4" data-testid="host-ref-panel">
      <Eyebrow>{REF_LABEL[reference.kind]}</Eyebrow>
      <h2 className="text-base font-medium text-ink">{q.data.title}</h2>
      <p className="font-mono text-xs break-all text-ink-faint">{q.data.ref}</p>
      {q.data.preview && (
        <ContentPanel mono className="whitespace-pre-wrap">
          {q.data.preview}
        </ContentPanel>
      )}
    </div>
  );
}
