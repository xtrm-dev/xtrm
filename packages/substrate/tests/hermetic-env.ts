// XTRM-677: preloaded by `npm test` (node --import). Every xt shell and
// specialist activation exports an identity; tests start from none, and a
// test that needs one sets it explicitly. Child processes inherit the cleared env.
for (const k of ["SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID", "SUBSTRATE_ISSUE_REF", "SUBSTRATE_ISSUE", "XTRM_SESSION_ID", "XTRM_SESSION_NAME"]) {
  delete process.env[k];
}
