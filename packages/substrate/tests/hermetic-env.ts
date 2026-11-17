// XTRM-677: preloaded by `npm test` (node --import). Every xt shell and
// specialist activation exports an identity; tests start from none, and a
// test that needs one sets it explicitly. Child processes inherit the cleared env.
for (const k of ["SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID", "SUBSTRATE_ISSUE_REF", "SUBSTRATE_ISSUE", "XTRM_SESSION_ID", "XTRM_SESSION_NAME"]) {
  delete process.env[k];
}

// XTRM-824: Node v25 prints an ExperimentalWarning for `node:sqlite` on the
// first import in a process. Four suites assert that a child wrote nothing to
// stderr, so the runtime's own notice read as a defect in the code under test.
//
// The exemption is exact on purpose: two known lines, in order, and nothing
// else. A different warning, an error, a stack trace or a truncation of the
// pair stays in the string and still fails the assertion that farms it. The
// alternative — `--no-warnings` or `--disable-warning=ExperimentalWarning` on
// the child — would hide every future experimental API in the package too.
const SQLITE_WARNING = /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time$/;
const TRACE_HINT = /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/;

/** Remove the node:sqlite startup warning pair, leaving every other byte of stderr intact. */
export function withoutNodeSqliteWarning(stderr: string): string {
  if (!stderr.includes("ExperimentalWarning: SQLite is an experimental feature")) return stderr;
  const lines = stderr.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SQLITE_WARNING.test(lines[i])) {
      if (i + 1 < lines.length && TRACE_HINT.test(lines[i + 1])) i++;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join("\n");
}
