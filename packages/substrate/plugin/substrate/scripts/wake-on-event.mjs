// Bounded watcher for the asyncRewake wake path (bead xtrm-iip.6, closeout E6).
//
// Contract with Claude Code: this script runs as an `asyncRewake` command hook.
// Env var is SUBSTRATE_ISSUE_REF, the Claude-side name (runtime.ts:45). The Pi
// surface uses SUBSTRATE_ISSUE (handlers.ts:48) — do not cross them.
// Exit 2 wakes the session even when idle, and stderr (or stdout when stderr is
// empty) is shown to Claude as a system reminder. Any other exit code is silent.
//
// AUTHORITY RULE (brief AA): the wake payload carries REFERENCES ONLY — issue
// ref, event count, reason. Never the event body, never an instruction. Claude
// wakes, then reads authoritative state through a Substrate tool. This watcher
// holds no durable state of its own; the event spine in the database is the
// truth and this process is a doorbell.
//
// Usage (hook config supplies the env):
//   SUBSTRATE_ISSUE_REF=<ref>   issue to watch (required; no ref → exit 0, silent)
//   SUBSTRATE_WAKE_TIMEOUT_MS  bound, default 900000 (15 min)
//   SUBSTRATE_WAKE_POLL_MS     poll interval, default 5000

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: the two guards below are proven zero-byte quiet paths (no write
// precedes either). The wake path writes one short line then drains via
// exitCode; exit codes unchanged (2 wake, 0 quiet). armPipeDrain() swallows
// only EPIPE.
armPipeDrain();

const EXIT_WAKE = 2;
const EXIT_QUIET = 0;

const ref = process.env["SUBSTRATE_ISSUE_REF"];
if (!ref) process.exit(EXIT_QUIET);

const timeoutMs = Number(process.env["SUBSTRATE_WAKE_TIMEOUT_MS"] ?? 900_000);
const pollMs = Number(process.env["SUBSTRATE_WAKE_POLL_MS"] ?? 5_000);

const { openHandles } = await resolveSubstrate("runtime.ts");

// One handle per poll: the WAL store is the shared authority and a long-lived
// read handle would pin a snapshot. Any failure is quiet — a watcher that
// crashes must never look like an event, and must never block the session.
function eventCount() {
  let handles;
  try {
    handles = openHandles();
    return handles.svc.listEvents(handles.svc.resolveRef(ref).id).length;
  } catch {
    return null;
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort
    }
  }
}

const baseline = eventCount();
if (baseline === null) process.exit(EXIT_QUIET);

const deadline = Date.now() + timeoutMs;
let woke = false;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, pollMs));
  const now = eventCount();
  if (now === null) continue;
  if (now > baseline) {
    // Reference-only payload. Deliberately says what to do next without
    // carrying the content that would make Claude act on unverified text.
    process.stderr.write(
      `Substrate event on ${ref}: ${now - baseline} new event(s) since this watcher armed. ` +
        `Read the durable record with resume_capsule ${ref} before acting.\n`,
    );
    woke = true;
    break;
  }
}

process.exitCode = woke ? EXIT_WAKE : EXIT_QUIET;
