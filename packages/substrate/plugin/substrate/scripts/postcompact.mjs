// PostCompact hook entry for the packaged plugin (bead xtrm-iip.1).
// See precompact.mjs for why these entry scripts are .mjs.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

const { handlePostCompact } = await resolveSubstrate("postcompact.ts");
const result = handlePostCompact(await readHookInput());

process.stdout.write(JSON.stringify({ ok: true, entryId: result.entryId, reason: result.reason ?? undefined }) + "\n");
process.exitCode = 0;
