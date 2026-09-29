import type { SpellTextRange } from './tokenizer'

/** `prose` checks plain text and Markdown only; `proseAndCode` also checks comments and strings. */
export type SpellcheckScope = 'prose' | 'proseAndCode'

export type SpellcheckCapture = {
  readonly startIndex: number
  readonly endIndex: number
  readonly captureName: string
}

export type SpellcheckRegionInput = {
  readonly languageId: string | null
  /** Null while the parse that decides which parts are prose has not landed. */
  readonly captures: readonly SpellcheckCapture[] | null
  readonly window: SpellTextRange
  readonly scope: SpellcheckScope
}

export type SpellcheckRegions = {
  /** Checked word by word as written. */
  readonly prose: readonly SpellTextRange[]
  /** Comments and strings: camelCase and snake_case are split. */
  readonly code: readonly SpellTextRange[]
  readonly excluded: readonly SpellTextRange[]
}

const PLAIN_LANGUAGES: ReadonlySet<string> = new Set(['plaintext', 'text'])
const MARKDOWN_LANGUAGES: ReadonlySet<string> = new Set(['markdown', 'mdx'])
// Inline and indented code, link targets and labels, and fenced code (`none`).
const MARKDOWN_SKIPPED: ReadonlySet<string> = new Set([
  'text.literal',
  'text.uri',
  'text.reference',
  'none',
])
const NO_REGIONS: SpellcheckRegions = { prose: [], code: [], excluded: [] }

/** Which parts of the window are checked, or null while the syntax that decides it is loading. */
export function spellcheckRegions(input: SpellcheckRegionInput): SpellcheckRegions | null {
  const { languageId, window } = input
  if (languageId === null || PLAIN_LANGUAGES.has(languageId)) {
    return { prose: [window], code: [], excluded: [] }
  }
  const isMarkdown = MARKDOWN_LANGUAGES.has(languageId)
  if (!isMarkdown && input.scope !== 'proseAndCode') return NO_REGIONS
  // Checking before the parse lands would mark words inside code for a moment.
  const captures = input.captures
  if (!captures) return null
  if (isMarkdown) {
    const excluded = capturesInWindow(captures, window, (name) => MARKDOWN_SKIPPED.has(name))
    return { prose: [window], code: [], excluded }
  }

  const code = capturesInWindow(captures, window, isCommentOrString)
  return { prose: [], code: mergeRanges(code), excluded: [] }
}

function isCommentOrString(name: string): boolean {
  return name.startsWith('comment') || name.startsWith('string')
}

function capturesInWindow(
  captures: readonly SpellcheckCapture[],
  window: SpellTextRange,
  keep: (name: string) => boolean,
): readonly SpellTextRange[] {
  const ranges: SpellTextRange[] = []
  for (const capture of captures) {
    if (!keep(capture.captureName)) continue
    const start = Math.max(capture.startIndex, window.start)
    const end = Math.min(capture.endIndex, window.end)
    if (end > start) ranges.push({ start, end })
  }
  return ranges
}

function mergeRanges(ranges: readonly SpellTextRange[]): readonly SpellTextRange[] {
  const merged: SpellTextRange[] = []
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) }
      continue
    }
    merged.push(range)
  }
  return merged
}
