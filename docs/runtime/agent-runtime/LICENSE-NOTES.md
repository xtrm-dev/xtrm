# Adoption License Handling

Canonical tracker: XTRM-91.

`ADOPTION-CREDITS.md` is attribution provenance, not a substitute for license compliance.

Before importing implementation code, tests, fixtures, protocol text or substantial documentation from an upstream reference:

1. verify the upstream repository license at the exact reviewed revision;
2. determine whether XTRM is doing behavior-compatible reimplementation, protocol interoperability, adapted code, or copied code;
3. preserve copyright/license notices required by the upstream license;
4. record the upstream revision and XTRM destination path in the implementing PR;
5. update `ADOPTION-CREDITS.md` if the adoption boundary changes.

Purely behavioral/design inspiration should still retain credit where it materially shaped XTRM, but must not be falsely described as copied source code.