// Model-free Pi load probe (bead xtrm-6qu.13).
//
// Proves the substrate extension loads and registers its tools WITHOUT any
// model call (no provider auth, quota, or network): DefaultResourceLoader
// against the enrolled agentDir, createAgentSession with an in-memory
// SessionManager, then inspect session.agent.state.tools plus extension
// load errors, then dispose.
//
// Usage:
//   node integrations/pi-load-check.ts --json [--dir <checkout>] [--home <home>]
// Exit 0: all 8 substrate tools registered, zero relevant extension errors.
// Exit 1: tools missing or relevant load errors. Exit 2: invalid checkout dir.
// `--home` defaults to the process HOME (the target HOME at `xt init` time).

import { homedir } from "node:os";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";
import { resolveSubstrateDir } from "./setup.ts";
import { packageRoot } from "../src/package-root.ts";
import { armPipeDrain } from "./write-and-exit.ts";

export const EXPECTED_SUBSTRATE_TOOLS = [
  "substrate_issue_get",
  "substrate_issue_search",
  "substrate_issue_claim",
  "substrate_issue_update",
  "substrate_issue_resume",
  "substrate_journal_append",
  "substrate_journal_checkpoint",
  "substrate_provenance_trace",
] as const;

export interface LoadProbeResult {
  ok: boolean;
  dir: string;
  home: string;
  tools: string[];
  missing: string[];
  extensionErrors: Array<{ path: string; error: string }>;
}

function truncate(s: string, n = 200): string {
  return s.slice(0, n);
}

export async function probePiLoad(pkgRoot: string, home: string): Promise<LoadProbeResult> {
  const base = { ok: false, dir: pkgRoot, home, tools: [] as string[], missing: [...EXPECTED_SUBSTRATE_TOOLS], extensionErrors: [] as LoadProbeResult["extensionErrors"] };
  const cwd = home;
  const agentDir = join(home, ".pi", "agent");
  let session: { dispose(): void } | null = null;
  try {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.create(cwd, agentDir),
    });
    await loader.reload();
    const created = await createAgentSession({
      cwd,
      agentDir,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      noTools: "builtin",
    });
    session = created.session;
    const tools = created.session.agent.state.tools.map((t) => t.name);
    const missing = EXPECTED_SUBSTRATE_TOOLS.filter((t) => !tools.includes(t));
    // Relevant errors: anything implicating the substrate extension or this
    // checkout. Unrelated broken packages must not fail substrate enrollment.
    const extensionErrors = (created.extensionsResult.errors ?? [])
      .filter((e) => /substrate/i.test(`${e.path} ${e.error}`) || `${e.path} ${e.error}`.includes(pkgRoot))
      .map((e) => ({ path: truncate(e.path), error: truncate(e.error) }));
    return { ok: missing.length === 0 && extensionErrors.length === 0, dir: pkgRoot, home, tools, missing, extensionErrors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, extensionErrors: [{ path: "<probe>", error: truncate(msg) }] };
  } finally {
    try {
      session?.dispose();
    } catch {
      // best-effort disposal never flips the verdict
    }
  }
}

const invokedAsMain = (process.argv[1]?.endsWith("pi-load-check.ts") || process.argv[1]?.endsWith("pi-load-check.js")) ?? false;
if (invokedAsMain) {
  // XTRM-335: every exit below drains (exitCode + natural return). The usage
  // guards halt via else-branching, not forced exit.
  armPipeDrain();
  await piLoadCheckMain();
}

// XTRM-335: main body as a function so usage-error paths halt with `return`
// after setting exitCode (drain) instead of process.exit() (truncate).
async function piLoadCheckMain(): Promise<void> {
  const json = process.argv.includes("--json");
  const flagValue = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    const v = i >= 0 ? process.argv[i + 1] : undefined;
    return v === undefined || v.startsWith("--") ? undefined : v;
  };
  const dirRaw = flagValue("--dir");
  const homeRaw = flagValue("--home");
  if (process.argv.includes("--dir") && dirRaw === undefined) {
    process.stderr.write("pi-load-check: --dir requires an absolute path value\n");
    process.exitCode = 2;
    return;
  }
  const resolved = resolveSubstrateDir(dirRaw);
  if (!resolved.ok && (dirRaw !== undefined || process.env["XTRM_SUBSTRATE_DIR"] !== undefined)) {
    process.stderr.write(`pi-load-check: ${resolved.error}\n`);
    process.exitCode = 2;
    return;
  }
  const dir = resolved.ok ? (resolved.dir as string) : packageRoot();
  const home = homeRaw ?? homedir();
  const result = await probePiLoad(dir, home);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`${result.ok ? "ok" : "FAIL"} pi-load tools=[${result.tools.join(",") || "none"}] missing=[${result.missing.join(",") || "none"}]\n`);
    for (const e of result.extensionErrors) process.stdout.write(`FAIL extension ${e.path} — ${e.error}\n`);
  }
  // XTRM-335: exitCode + natural drain so the result JSON is never truncated
  // on a pipe; exit code unchanged (0 loaded, 1 missing/errors).
  process.exitCode = result.ok ? 0 : 1;
}
