import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IssueService } from "../../service/issue-service.ts";

// Filesystem projection (PRD §7.2): Markdown/JSON are inspectable projections,
// never the canonical mutable store.

export function renderTreeMarkdown(svc: IssueService, projectId: string): string {
  const issues = svc.listIssues(projectId);
  const roots = issues.filter((i) => svc.getParent(i.id) === null);
  const lines = [`# Issue tree — ${projectId}`, ``];
  const walk = (id: string, depth: number): void => {
    const issue = svc.getIssue(id);
    lines.push(`${"  ".repeat(depth)}- ${issue.locator} · ${issue.humanRef} · ${issue.title} [${issue.lifecycleState}]`);
    for (const child of svc.listChildren(id)) walk(child.id, depth + 1);
  };
  for (const r of roots) walk(r.id, 0);
  return lines.join("\n") + "\n";
}

// Portable snapshot writer: tree rendering plus the canonical export bundle
// input (revision-preserving; G47 equivalence is owned by export/import).
export function writeFilesystemProjection(svc: IssueService, projectId: string, dir: string): { treePath: string; snapshotPath: string } {
  mkdirSync(dir, { recursive: true });
  const treePath = join(dir, "tree.md");
  const snapshotPath = join(dir, "issues.json");
  writeFileSync(treePath, renderTreeMarkdown(svc, projectId));
  writeFileSync(snapshotPath, JSON.stringify(svc.exportProject(projectId), null, 2));
  return { treePath, snapshotPath };
}
