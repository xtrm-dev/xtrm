// BeadsWorkItemStore: temporary read-only compatibility over the passive
// Beads JSONL export (PRD §35 Phase A; §42: no permanent dual-write). Reads
// (get/search) parse the export snapshot defensively; every mutation fails
// closed with an explicit compat error naming the Substrate equivalent.
// There is deliberately no write path: a second write authority would fork
// the work graph. The D-35 conformance table records each cell as pass/fail
// with these parity notes.

import { readFileSync, statSync } from "node:fs";
import type {
  ChangeBatch,
  CheckpointInput,
  ClaimView,
  IssueView,
  JournalEntryView,
  WorkItemStore,
  AttestationInput,
} from "./store.ts";

interface BeadsRecord {
  id: string;
  title: string;
  status: string;
  kind: string;
  priority: number;
}

function compatError(method: string): Error {
  return new Error(
    `beads backend is read-only compatibility: ${method} has no Beads write path by design (no dual-write, §42); perform it against the Substrate backend`,
  );
}

export class BeadsWorkItemStore implements WorkItemStore {
  readonly backend = "beads" as const;
  private readonly exportPath: string;
  private cache: { mtime: number; records: BeadsRecord[] } | null = null;

  constructor(exportPath = ".beads/issues.jsonl") {
    this.exportPath = exportPath;
  }

  private load(): BeadsRecord[] {
    let mtime: number;
    let raw: string;
    try {
      mtime = statSync(this.exportPath).mtimeMs;
      raw = readFileSync(this.exportPath, "utf8");
    } catch {
      throw new Error(`beads export not readable: ${this.exportPath} (run bd export first)`);
    }
    if (this.cache && this.cache.mtime === mtime) return this.cache.records;
    const records: BeadsRecord[] = [];
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const r = JSON.parse(t) as Record<string, unknown>;
        if (typeof r["id"] !== "string") continue;
        records.push({
          id: r["id"] as string,
          title: typeof r["title"] === "string" ? (r["title"] as string) : "(untitled)",
          status: typeof r["status"] === "string" ? (r["status"] as string) : "open",
          kind: typeof r["kind"] === "string" ? (r["kind"] as string) : "task",
          priority: typeof r["priority"] === "number" ? (r["priority"] as number) : 0,
        });
      } catch {
        continue;
      }
    }
    this.cache = { mtime, records };
    return records;
  }

  private view(r: BeadsRecord): IssueView {
    // Export projection only: no contract, no attestation, no live claim —
    // readiness fields report the export's stored status verbatim and mark
    // the gap, so no caller mistakes this for a dispatchable view.
    return {
      issue: {
        id: r.id,
        projectId: "",
        humanNumber: 0,
        kind: r.kind as never,
        title: r.title,
        lifecycleState: "open",
        priority: r.priority,
        scrutiny: "",
        currentRevision: 0,
        currentContractHash: "",
        deferUntil: null,
        createdAt: 0,
        updatedAt: 0,
        humanRef: r.id,
        locator: r.id,
      },
      contract: null,
      readinessState: `beads-export:${r.status}`,
      dispatchable: false,
      reasons: ["beads compat view is never dispatchable: import via sb import beads, then plan"],
    };
  }

  get(ref: string): IssueView {
    const hit = this.load().find((r) => r.id === ref);
    if (!hit) throw new Error(`unknown beads id: ${ref}`);
    return this.view(hit);
  }

  search(_project: string, query?: string, kind?: string): IssueView[] {
    const q = (query ?? "").toLowerCase();
    return this.load()
      .filter((r) => (kind ? r.kind === kind : true))
      .filter((r) => (q ? `${r.title} ${r.id}`.toLowerCase().includes(q) : true))
      .map((r) => this.view(r));
  }

  ready(_project: string): IssueView[] {
    return [];
  }

  validate(ref: string): IssueView {
    return this.get(ref);
  }

  resolveContext(_ref: string): { hash: string; entryCount: number } {
    throw compatError("resolveContext");
  }

  claim(_ref: string, _holder: string): ClaimView {
    throw compatError("claim");
  }

  claimReady(_ref: string, _holder: string, _attestation: AttestationInput): { claim: ClaimView; attestedRevision: number } {
    throw compatError("claimReady");
  }

  renew(_ref: string, _holder: string): ClaimView {
    throw compatError("renew");
  }

  release(_ref: string, _holder: string): boolean {
    throw compatError("release");
  }

  update(_ref: string, _contract: unknown): { view: IssueView; revisionCreated: boolean } {
    throw compatError("update");
  }

  addEdge(_fromRef: string, _toRef: string, _kind: string): { edgeId: number | null; kind: string } {
    throw compatError("addEdge");
  }

  addJournal(_ref: string, _kind: string): JournalEntryView {
    throw compatError("addJournal");
  }

  async checkpoint(_ref: string, _input?: CheckpointInput): Promise<JournalEntryView> {
    throw compatError("checkpoint");
  }

  close(_ref: string): IssueView {
    throw compatError("close");
  }

  changesSince(_ref: string, _afterEventId: number): ChangeBatch {
    throw compatError("changesSince");
  }
}
