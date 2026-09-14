// Shared write-and-exit helper (XTRM-335).
//
// The write-then-process.exit pattern truncates piped output at the 64 KiB
// pipe buffer: writes to a pipe are asynchronous, so process.exit() discards
// whatever has not flushed yet (XTRM-331, fixed for the sb CLI in b911997).
// The same defect existed in the package's other entrypoints, whose payloads
// are small today but scale in at least one case (`setup --json` grows with
// the enumerated home inventory).
//
// Pattern (mirrors cli/sb.ts): attach armPipeDrain() once at entrypoint
// start, then set process.exitCode and return so the event loop drains
// pending stdout/stderr before a natural exit. Never call process.exit()
// after a write whose payload can exceed the pipe buffer.
//
// EPIPE: an early-closing reader (`| head -c 10`) makes stdout/stderr emit
// EPIPE. That is a normal end of output, not a failure: without a handler it
// surfaces as an unhandled 'error' event that replaces the real exit code.
// armPipeDrain() swallows EPIPE only; genuine write failures still throw.
//
// Scope rule (XTRM-335 SUCCESS): EVERY path that writes and then terminates
// drains via exitCode + natural return — 'short line' is not an exemption.
// Immediate process.exit() remains ONLY on proven zero-byte quiet paths
// (no stream write precedes the exit), halted by else-branching or early
// guards. Every site calls armPipeDrain() so a closed reader never surfaces
// as a crash. This module is dependency-free on purpose: hooks must never
// depend on the CLI module tree (contract non-goal).

export function armPipeDrain(): void {
  for (const stream of [process.stdout, process.stderr] as NodeJS.WriteStream[]) {
    stream.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") throw err;
    });
  }
}
