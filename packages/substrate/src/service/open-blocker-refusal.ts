// XTRM-980: one vocabulary for "this issue still has an open blocker".
//
// Two paths reach the same predicate (XTRM-959's `settleOpenBlockers` and the
// legacy bare close; XTRM-967's terminal-state guard in
// `IssueService.setLifecycleState`) and each built its own refusal sentence. The
// second was written before the first merged, so the two drifted while asserting
// the same rule — the vocabulary a caller learns from one refusal should not be
// re-learned from the other.
//
// The rule itself stays where it is: each caller decides *whether* a blocker is
// open (this module never reads the store) and passes human refs, because the
// person reading the refusal acts on refs, not on internal ids.
//
// TWO parameters, and no more:
//
//   - `mode` — "close" or "transition". This is the knob, deliberately, rather
//     than a free-text remedy: the remedy follows from the mode, so there is
//     nothing to pass that could smuggle in a second vocabulary. A builder that
//     accepted a sentence would accept any sentence and prove nothing.
//   - `action` — what was refused, after "refusing to": `close XTRM-1`,
//     `mark XTRM-1 done`. Naming the operation is what tells a caller which
//     command refused them, so it is not flattened to a shared verb.
//
// What the mode decides, beyond wording: a close writes a Closure row, so its
// remedy can name the outcome the caller already chose. A state transition has
// nowhere to record a reason, so its remedy points at a close, which does. Both
// remedies quote `--force-close-with-open-blocker` *inside* an
// `sb issue close …` command, because the flag belongs to the close verb: the
// state path must not look like it accepts the flag, and `sb issue state … done
// --force-close-with-open-blocker …` is refused at the surface as a strict-flag
// error (`a1-lifecycle.test.ts`, "the state verb refuses the close verb's
// override flag").
//
// `shared` is therefore the part that must read identically from both paths, and
// `remedy` is the part the mode is allowed to change. The parity test asserts
// exactly that.

/** Which command refused: a close that can record an override, or a transition that cannot. */
export type BlockerRefusalMode = "close" | "transition";

export type OpenBlockerRefusalInput = {
  readonly mode: BlockerRefusalMode;
  /** What was refused, after "refusing to": `close XTRM-1`, `mark XTRM-1 done`. */
  readonly action: string;
  /** Human refs of the blockers that are still open. Never empty. */
  readonly blockers: readonly string[];
  /** The issue whose transition was refused, as a locator a command accepts. */
  readonly locator: string;
  /** The outcome the close is carrying; read only in "close" mode. */
  readonly outcome?: string;
};

export type OpenBlockerRefusal = {
  /** `shared` and `remedy`, joined: the whole message. */
  readonly message: string;
  /** The rule and the blocker refs — identical for both modes given the same input. */
  readonly shared: string;
  /** The way out — the only part the mode changes. */
  readonly remedy: string;
};

/**
 * Builds the refusal thrown when an issue would be finished while a declared
 * blocker is still open. Pure: it takes refs, it does not look anything up.
 */
export function openBlockerRefusal(input: OpenBlockerRefusalInput): OpenBlockerRefusal {
  const { mode, action, blockers, locator } = input;
  // A refusal with no refs would name nothing to act on, and an empty `Close
  //  first` reads like a template that lost its argument. Callers already
  // branch on "no open blockers", so reaching here means a caller bug.
  if (blockers.length === 0) {
    throw new Error("openBlockerRefusal needs at least one blocker: a refusal that names none has no remedy");
  }
  const refs = blockers.join(", ");
  const shared =
    `refusing to ${action}: ${blockers.length === 1 ? "blocker" : "blockers"} ${refs} ` +
    `${blockers.length === 1 ? "is" : "are"} still open. A blocker is satisfied only when it is itself terminal ` +
    `(done or archived): an open PR is not evidence, and neither is a merged one — this guard reads the ` +
    `blocker's lifecycle state, not its PRs.`;
  // Both remedies end with the same close command shape; only the outcome slot
  // and the framing sentence differ, because only the close path can record a
  // reason for going past the blocker.
  const closeCommand = (outcome: string) =>
    `sb issue close ${locator} --outcome ${outcome} --reason "<why this issue is finished>" ` +
    `--force-close-with-open-blocker "<why ${refs} no longer binds>"`;
  const remedy =
    mode === "close"
      ? `Close ${refs} first, or state why it no longer binds: ${closeCommand(input.outcome ?? "completed")}`
      : `Close ${refs} first, or record the decision where it can be read: ` +
        `${closeCommand("<completed|wont_fix|invalid|abandoned>")}`;
  return { message: `${shared} ${remedy}`, shared, remedy };
}
