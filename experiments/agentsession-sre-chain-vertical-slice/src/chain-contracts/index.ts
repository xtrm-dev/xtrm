/**
 * Chain authored-form contracts (xtrm-qcy.1).
 *
 * Canonical public surface for xtrm-qcy.2 (ChainLoader) and xtrm-qcy.3
 * (pure compiler → ResolvedChain). Placement note: this module lives in
 * the vertical-slice tree to reuse its zod/TS/bun-test machinery; it is a
 * canonical bead deliverable (ADR-001 / runtime PRD §2) and is the
 * promotion seed for the future native runtime package.
 */

export * from "./chain-source.ts";
export * from "./chain-definition.ts";
export * from "./normalize.ts";
export * from "./json-schema.ts";
