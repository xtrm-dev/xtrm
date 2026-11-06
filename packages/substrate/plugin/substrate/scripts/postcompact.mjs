// PostCompact hook entry for the packaged plugin (bead xtrm-iip.1).
// See precompact.mjs for why these entry scripts are .mjs.

import { applyServerArguments, proxyHook } from "./remote-hook.mjs";
import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

async function main() {


const { handlePostCompact } = await resolveSubstrate("postcompact.ts");
const result = handlePostCompact(await readHookInput());

process.stdout.write(JSON.stringify({ ok: true, entryId: result.entryId, reason: result.reason ?? undefined }) + "\n");
// exit code is set by main()'s caller
  return 0;
}

try {
  // XTRM-692: with a remote configured the answer comes from the store-owning
  // machine; the handler below runs only for a local deployment.
  applyServerArguments();
  const forwarded = await proxyHook("postcompact.mjs");
  process.exitCode = forwarded === false ? await main() : forwarded;
} catch (err) {
    process.stdout.write(JSON.stringify({ degraded: true, reason: `substrate remote unavailable: ${err.code}: ${err.message}` }) + "\n");
    process.exitCode = 0;
}
