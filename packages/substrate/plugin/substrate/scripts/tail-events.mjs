// Plugin monitor for the Substrate event spine (bead xtrm-iip.6, closeout E6).
//
// Contract with Claude Code: every stdout line becomes one session event.
// Monitor output is NOTIFICATION INPUT, never durable state — each line names
// an issue ref and an event type, and Claude reads the record through a
// Substrate tool. Started by monitors/monitors.json on first dispatch of the
// using-substrate skill, not at every session start.
//
// Availability (documented, not assumed): monitors run in interactive CLI
// sessions only, are unavailable on Amazon Bedrock, Google Cloud's Agent
// Platform and Microsoft Foundry, and are skipped when DISABLE_TELEMETRY or
// CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set. Nothing may depend on this
// monitor running.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: both guards below are the only immediate exits left (proven
// zero-byte quiet paths: no stream write precedes either). The monitor loop
// writes lines indefinitely and never calls process.exit. armPipeDrain()
// swallows only EPIPE.
armPipeDrain();

const ref = process.env["SUBSTRATE_ISSUE_REF"];
if (!ref) process.exit(0);

const pollMs = Number(process.env["SUBSTRATE_MONITOR_POLL_MS"] ?? 15_000);
const { openHandles } = await resolveSubstrate("runtime.ts");

function readEvents() {
  let handles;
  try {
    handles = openHandles();
    return handles.svc.listEvents(handles.svc.resolveRef(ref).id);
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

const first = readEvents();
if (first === null) process.exit(0);
let seen = first.length;

// Unbounded by design: a monitor is a session-length watch, stopped when the
// session ends or the operator cancels it.
for (;;) {
  await new Promise((r) => setTimeout(r, pollMs));
  const events = readEvents();
  if (events === null) continue;
  for (const event of events.slice(seen)) {
    process.stdout.write(`substrate ${ref}: ${event.type} at ${event.createdAt}\n`);
  }
  seen = events.length;
}
