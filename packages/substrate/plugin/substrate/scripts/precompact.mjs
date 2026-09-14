// PreCompact hook entry for the packaged plugin (bead xtrm-iip.1).
// Thin adapter: reads the hook JSON on stdin, calls the typed handler
// in-process, writes the advisory JSON result, always exits 0 — compaction
// must proceed whatever happens here.
//
// .mjs, not .ts: the handler module self-invokes when
// process.argv[1].endsWith("precompact.ts"), so a .ts entry script here would
// run the handler twice.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

const { handlePreCompact } = await resolveSubstrate("precompact.ts");
const result = await handlePreCompact(await readHookInput());

process.stdout.write(
  JSON.stringify({
    continue: result.continue,
    entryId: result.entryId,
    sequence: result.sequence,
    degraded: result.degraded,
    reason: result.reason ?? null,
  }) + "\n",
);
process.exitCode = 0;
