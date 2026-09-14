// Shared write-and-exit helper for the packaged plugin adapters (XTRM-335).
//
// .mjs mirror of integrations/write-and-exit.ts: these entry scripts cannot
// import the TS helper without a TS loader, and must never depend on the CLI
// module tree, so the (dependency-free) EPIPE guard lives here too.
// Same contract: an early-closing reader (`| head -c 10`) makes stdout/stderr
// emit EPIPE, which is a normal end of output, not a failure. Swallow EPIPE
// only; genuine write failures still throw.
export function armPipeDrain() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (err) => {
      if (err?.code !== "EPIPE") throw err;
    });
  }
}
