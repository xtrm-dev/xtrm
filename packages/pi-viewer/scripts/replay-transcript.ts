// Replay a transcript record by record and print the agent's status transitions and any
// harness violation (XTRM-1043). Works on a redacted fixture or a real transcript.
//
//   node scripts/replay-transcript.ts <pi|claude> <transcript.jsonl> [scratch-dir] [fresh-every]
//
// fresh-every (default 1) compares with a fresh parse every N records; use 25 or more for a
// whole real transcript, whose fresh parses cost O(n^2).
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { replay, transitions, type Provider } from "../test/replay/harness.ts"

const [, , provider, file, scratchArg, everyArg] = process.argv
if ((provider !== "pi" && provider !== "claude") || !file) {
  console.error("usage: replay-transcript.ts <pi|claude> <transcript.jsonl> [scratch-dir]")
  process.exit(2)
}
const scratch = scratchArg ?? mkdtempSync(join(tmpdir(), "pi-viewer-replay-"))
const result = replay(file, provider as Provider, scratch, "replay", Number(everyArg ?? 1) || 1)
console.log(transitions(result).join("\n"))
console.log(`\n${result.snapshots.length} records, ${result.violations.length} violations`)
for (const violation of result.violations) console.log(`!! ${violation}`)
process.exit(result.violations.length ? 1 : 0)
