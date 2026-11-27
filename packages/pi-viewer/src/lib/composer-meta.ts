/**
 * The composer's under-row metadata (XTRM-1054): the target agent's model and thinking effort, beside
 * the To selector. The values are the ones the agent payload already carries and the presence detail
 * shows (`ViewerAgent.model`, `ViewerAgent.thinkingLevel`); nothing is derived or guessed, and a value
 * the runtime does not report is omitted. One function, so the row and its test agree.
 */
export interface ComposerMeta {
  model: string | null
  /** The bare effort level (`high`), as the under-row shows it beside the model. */
  effort: string | null
  /** The full phrase (`model · thinking <level>`), for the row's title and its accessible name. */
  label: string | null
}

export function composerMeta(
  agent: { model: string | null; thinkingLevel: string | null } | null | undefined,
): ComposerMeta {
  const model = agent?.model?.trim() || null
  const level = agent?.thinkingLevel?.trim() || null
  const effort = level || null
  const phrase = level ? `thinking ${level}` : null
  const label = [model, phrase].filter(Boolean).join(" · ") || null
  return { model, effort, label }
}
