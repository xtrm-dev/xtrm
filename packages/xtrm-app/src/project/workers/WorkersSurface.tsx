import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import { projectForRepo, useProjects } from "../../app/queries.ts";
import { useShell } from "../../shell/context.tsx";
import { ErrorState, LoadingState, TOOLBAR_CONTROL, TOOLBAR_GHOST, cx } from "../../ui/primitives.tsx";
import { IntegrationState } from "../IntegrationState.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { BoardWorkerRow } from "./WorkerRow.tsx";
import { WorkersTree } from "./WorkersTree.tsx";
import { buildFlatGroups, buildWorkersTree } from "./model.ts";

/**
 * Project Workers (console-ui-system §6, XTRM-819): the tree the operator asked for —
 * lead → worker → specialist activation, with the issue and PR as each node's trail.
 *
 * Edges are durable Substrate evidence (`sb provenance graph` through the bridge's
 * `/graph` route); the board's `workers/*` records only enrich a node, joined on the
 * issue ref. A node with no dispatcher edge is grouped under "unknown dispatcher" and a
 * board worker the graph does not mention stays visible there — neither is guessed into
 * a chain. The flat toggle is the status-grouped list with the archived control.
 *
 * Read-only (§6, ADR-002 assumption 3): nothing here writes to the board or to Substrate.
 */
export function validateWorkersSearch(search: Record<string, unknown>): { view?: "list"; archived?: true } {
  const out: { view?: "list"; archived?: true } = {};
  if (search.view === "list") out.view = "list";
  if (search.archived === true || search.archived === "1") out.archived = true;
  return out;
}

export function WorkersSurface() {
  const { repo } = useShell();
  const { statusBoard, substrate } = useAdapters();
  const repository = repo.fullName;
  const base = `/rep/${repo.owner}/${repo.name}`;
  const search = useSearch({ strict: false }) as { view?: string; archived?: boolean };
  const navigate = useNavigate();

  const binding = useQuery({ queryKey: ["project", "binding", repository], queryFn: () => statusBoard.binding(repository), staleTime: 60_000 });
  const bound = binding.data?.configured === true;
  const health = useQuery({ queryKey: ["project", "health", repository], queryFn: () => statusBoard.health(repository), staleTime: 60_000, enabled: bound });
  const workers = useQuery({ queryKey: ["project", "workers", repository], queryFn: () => statusBoard.listWorkers(repository), staleTime: 60_000, enabled: bound });
  const projects = useProjects();
  const projectId = projectForRepo(projects.data, repo)?.id ?? null;
  // One bounded page is enough for a project's live fleet; the read reports what it omitted.
  const graph = useQuery({
    queryKey: ["project", "dispatch-graph", projectId],
    queryFn: () => substrate.dispatchGraph(projectId!, { limit: 500 }),
    staleTime: 60_000,
    enabled: projectId !== null,
  });

  const view = search.view === "list" ? "list" : "tree";
  const includeArchived = search.archived === true;
  const now = Date.now();
  const rows = (workers.data?.records ?? []).map((r) => r.doc);
  const model = graph.data ? buildWorkersTree(graph.data, rows) : null;
  const flat = buildFlatGroups(rows, { includeArchived });

  const setSearch = (next: { view?: string; archived?: boolean }) =>
    navigate({ to: `${base}/project/workers`, search: { ...next } as never, replace: true });

  // Rendered inside ProjectShell's own header row, so this is controls only.
  const toolbar = (
    <>
      <span className="flex items-center gap-1" role="group" aria-label="Workers view">
        <button
          type="button"
          className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST, view === "tree" && "bg-pressed text-ink")}
          aria-pressed={view === "tree"}
          onClick={() => setSearch({})}
        >
          Tree
        </button>
        <button
          type="button"
          className={cx(TOOLBAR_CONTROL, TOOLBAR_GHOST, view === "list" && "bg-pressed text-ink")}
          aria-pressed={view === "list"}
          onClick={() => setSearch({ view: "list" })}
        >
          List
        </button>
      </span>
      {view === "list" && (
        <label className="flex items-center gap-1 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setSearch({ view: "list", ...(e.target.checked ? { archived: true } : {}) })}
            aria-label="Include archived workers"
          />
          include archived ({flat.archivedCount})
        </label>
      )}
      <span className="text-xs text-ink-faint" data-testid="workers-count">
        {rows.length} workers
      </span>
      {graph.data && (
        <span className="text-xs text-ink-faint" data-testid="graph-count">
          graph {graph.data.nodes.length} nodes, {graph.data.edges.length} edges
          {graph.data.truncated ? ` (${graph.data.omittedBindings} bindings omitted)` : ""}
        </span>
      )}
    </>
  );

  const shell = (children: ReactNode) => (
    <ProjectShell title="Workers" binding={binding.data ?? null} health={bound ? (health.data ?? null) : null} source={statusBoard.source} toolbar={toolbar}>
      {children}
    </ProjectShell>
  );

  if (!bound) {
    return shell(<IntegrationState binding={binding.data ?? null} health={null} base={base} />);
  }
  if (workers.isLoading) return shell(<LoadingState label="Loading workers" />);
  if (workers.error) return shell(<ErrorState title="Workers could not be read" error={workers.error} />);

  if (view === "list") {
    return shell(
      <div data-testid="workers-list">
        {flat.groups.length === 0 && <p className="px-1.5 py-2 text-xs text-ink-faint">No workers on this board.</p>}
        {flat.groups.map((group) => (
          <section key={group.status ?? "no-status"} aria-label={`Workers ${group.status ?? "without a status"}`}>
            <h3 className="px-1.5 pt-2 pb-1 text-xs font-medium text-ink-muted">{group.status ?? "no status"}</h3>
            {group.rows.map((worker) => (
              <BoardWorkerRow key={worker.name} worker={worker} now={now} testid="worker-flat-row" />
            ))}
          </section>
        ))}
      </div>,
    );
  }

  return shell(
    <div>
      <div className="px-1.5 pt-1 text-xs text-ink-faint">
        {projectId === null
          ? "This repository is not bound to a Substrate project, so the dispatch graph is not available; the tree falls back to the board records."
          : graph.isLoading
            ? "Reading the dispatch graph…"
            : null}
      </div>
      {graph.error && (
        <p className="px-1.5 py-1 text-xs text-danger" data-testid="graph-error">
          The dispatch graph could not be read: {graph.error instanceof Error ? graph.error.message : "unknown error"}. Every worker is listed under unknown dispatcher.
        </p>
      )}
      {model ? (
        <WorkersTree model={model} now={now} />
      ) : (
        <div data-testid="workers-board-only">
          {flat.groups.map((group) =>
            group.rows.map((worker) => <BoardWorkerRow key={worker.name} worker={worker} now={now} testid="worker-flat-row" />),
          )}
        </div>
      )}
    </div>,
  );
}
