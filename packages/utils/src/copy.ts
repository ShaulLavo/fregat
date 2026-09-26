/**
 * Contrast phrasing, which the Copy rule in AGENTS.md bans from app text: a thing
 * described by what it is not. Negated facts ("That path is not a folder") pass.
 */
const CONTRAST_PHRASE = /[,;—–]\s*not\s|\brather than\b|\binstead of\b/i

/** The first contrast phrase in `text`, or null when it has none. */
export function contrastPhrase(text: string): string | null {
  return CONTRAST_PHRASE.exec(text)?.[0].trim() ?? null
}
