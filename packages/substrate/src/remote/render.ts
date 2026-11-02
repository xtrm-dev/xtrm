// Human output for the remote surfaces. `--json` carries the same facts; these
// lines are what an operator reads to decide whether the setup is sound.

import type { RemoteDoctorReport } from "./doctor.ts";
import type { RemoteSetupResult } from "./setup.ts";

// Mapping age, so an operator can tell a fresh verification from a cached one.
function ageOf(verifiedAt: number): string {
  if (verifiedAt <= 0) return "age unknown";
  const seconds = Math.max(0, Math.round((Date.now() - verifiedAt) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function renderRemoteSetup(result: RemoteSetupResult, configPath: string): string {
  const lines = [
    `sb remote: ${result.remote} (config: ${configPath})`,
    `sb on server: ${result.sbPath} (${result.serverVersion}${result.latencyMs === null ? "" : `, ${result.latencyMs} ms`})`,
  ];
  if (result.repositoryKey === null) {
    lines.push("repository: (not a Git checkout)");
  } else {
    lines.push(`repository: ${result.repositoryKey}`);
    lines.push(
      result.checkout === null
        ? "server checkout: (not mapped)"
        : `server checkout: ${result.checkout.root}${result.checkout.projectId === null ? "" : ` (project ${result.checkout.projectId})`}`,
    );
  }
  if (result.candidates.length > 0) lines.push(`server checkouts: ${result.candidates.join(", ")}`);
  for (const warning of result.warnings) lines.push(`warning: ${warning}`);
  lines.push("every sb invocation in this checkout now runs on the server; --db and SUBSTRATE_DB still select the local store.");
  return lines.join("\n") + "\n";
}

export function renderRemoteStatus(report: RemoteDoctorReport): string {
  if (report.mode === "local") {
    const lines = [
      "sb remote: local (no remote configured)",
      `config: ${report.configPath}`,
      "configure with: sb remote setup ssh:<host>",
    ];
    if (report.note !== null) lines.push(`note: ${report.note}`);
    if (report.error !== null) lines.push(`error: ${report.error}`);
    return lines.join("\n") + "\n";
  }
  const lines = [
    `sb remote: ${report.remote} (config: ${report.configPath})`,
    `sb on server: ${report.remoteSb ?? "(unresolved)"}${report.serverVersion === null ? "" : ` (${report.serverVersion})`}${
      report.latencyMs === null ? "" : `, ${report.latencyMs} ms`
    }`,
    `repository: ${report.repositoryKey ?? "(not a Git checkout)"}`,
    report.checkout === null
      ? "server checkout: (not mapped)"
      : `server checkout: ${report.checkout.root}${report.checkout.projectId === null ? "" : ` (project ${report.checkout.projectId})`}${report.checkout.cached ? " [cached]" : ""} (verified ${ageOf(report.checkout.verifiedAt)})`,
  ];
  if (report.note !== null) lines.push(`note: ${report.note}`);
  if (report.error !== null) lines.push(`error: ${report.error}`);
  lines.push("capabilities:");
  for (const [name, text] of Object.entries(report.capabilities)) lines.push(`  ${name}: ${text}`);
  return lines.join("\n") + "\n";
}

export function renderRemoteDoctor(report: RemoteDoctorReport): string {
  return renderRemoteStatus(report);
}
