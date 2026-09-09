/**
 * A slice of terminal output handed to the agent as context.
 *
 * `source` is the terminal it came from (its session id), and the line numbers
 * are 1-based rows of that terminal's buffer, scrollback included, so the agent
 * can talk about "line 812" the same way the user reads it on screen.
 */
export type TerminalContextSelection = {
  readonly lineEnd: number
  readonly lineStart: number
  readonly source: string
  readonly text: string
}

const PREVIEW_LIMIT = 80

/**
 * The block is XML-shaped so an agent reads it as structured context rather
 * than as part of the prompt. That only holds if terminal output can never
 * close a tag it did not open, which is what the escaping below buys.
 */
const BLOCK_OPEN = '<terminal_context>'
const BLOCK_CLOSE = '</terminal_context>'
const SELECTION_CLOSE = '</selection>'
const TRAILING_BLOCK_PATTERN = /\n*<terminal_context>\n([\s\S]*?)\n<\/terminal_context>\s*$/
const SELECTION_PATTERN =
  /<selection source="([^"]*)" lines="(\d+)(?:-(\d+))?">\n([\s\S]*?)\n<\/selection>/g
const ESCAPED_PATTERN = /&(amp|lt|gt|quot);/g
const ESCAPES: Readonly<Record<string, string>> = {
  '"': '&quot;',
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
}
const UNESCAPES: Readonly<Record<string, string>> = {
  amp: '&',
  gt: '>',
  lt: '<',
  quot: '"',
}

export function normalizeTerminalContextText(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '')
  // A drag that caught only padding is not context, however many cells it spanned.
  // Interior indentation survives: only an entirely blank capture is dropped.
  return normalized.trim().length === 0 ? '' : normalized
}

/**
 * Returns null for anything that would render as an empty chip: a whitespace
 * drag, a terminal with no id. Callers treat null as "nothing was selected".
 */
export function normalizeTerminalContextSelection(
  selection: TerminalContextSelection,
): TerminalContextSelection | null {
  const text = normalizeTerminalContextText(selection.text)
  const source = selection.source.trim()
  if (text.length === 0) return null
  if (source.length === 0) return null

  const lineStart = Math.max(1, Math.floor(selection.lineStart))

  return {
    lineEnd: Math.max(lineStart, Math.floor(selection.lineEnd)),
    lineStart,
    source,
    text,
  }
}

export function formatTerminalContextRange(selection: {
  readonly lineEnd: number
  readonly lineStart: number
}) {
  if (selection.lineStart === selection.lineEnd) return `line ${selection.lineStart}`

  return `lines ${selection.lineStart}-${selection.lineEnd}`
}

export function formatTerminalContextLabel(selection: {
  readonly lineEnd: number
  readonly lineStart: number
  readonly source: string
}) {
  return `${selection.source} ${formatTerminalContextRange(selection)}`
}

/**
 * One line, because the chip sits inline in a message. The ellipsis is the only
 * signal that more was captured than is shown, so it has to appear for a long
 * first line and for a second line alike.
 */
export function terminalContextPreview(text: string) {
  const normalized = normalizeTerminalContextText(text)
  const firstLine = normalized.split('\n', 1)[0] ?? ''
  if (firstLine.length > PREVIEW_LIMIT) return `${firstLine.slice(0, PREVIEW_LIMIT)}…`
  if (normalized.length > firstLine.length) return `${firstLine}…`

  return firstLine
}

export function buildTerminalContextBlock(contexts: readonly TerminalContextSelection[]): string {
  const lines: string[] = []

  for (const context of contexts) {
    const selection = normalizeTerminalContextSelection(context)
    if (!selection) continue

    lines.push(openSelectionTag(selection), escapeMarkup(selection.text), SELECTION_CLOSE)
  }
  if (lines.length === 0) return ''

  return [BLOCK_OPEN, ...lines, BLOCK_CLOSE].join('\n')
}

export function parseTerminalContextBlock(block: string): TerminalContextSelection[] {
  const selections: TerminalContextSelection[] = []

  for (const match of block.matchAll(SELECTION_PATTERN)) {
    const lineStart = Number(match[2])
    const selection = normalizeTerminalContextSelection({
      lineEnd: match[3] === undefined ? lineStart : Number(match[3]),
      lineStart,
      source: unescapeMarkup(match[1] ?? ''),
      text: unescapeMarkup(match[4] ?? ''),
    })
    if (!selection) continue

    selections.push(selection)
  }

  return selections
}

export function appendTerminalContextsToPrompt(
  prompt: string,
  contexts: readonly TerminalContextSelection[],
) {
  const block = buildTerminalContextBlock(contexts)
  const trimmed = prompt.trim()
  if (block.length === 0) return trimmed
  if (trimmed.length === 0) return block

  return `${trimmed}\n\n${block}`
}

/**
 * Splits a stored user message back into what the person typed and what the
 * composer attached, so the transcript can render chips instead of replaying
 * the raw block at the reader.
 */
export function extractTerminalContexts(prompt: string): {
  contexts: TerminalContextSelection[]
  text: string
} {
  const match = TRAILING_BLOCK_PATTERN.exec(prompt)
  if (!match) return { contexts: [], text: prompt }

  return {
    contexts: parseTerminalContextBlock(match[1] ?? ''),
    text: prompt.slice(0, match.index).replace(/\n+$/, ''),
  }
}

function openSelectionTag(selection: TerminalContextSelection) {
  const lines =
    selection.lineStart === selection.lineEnd
      ? `${selection.lineStart}`
      : `${selection.lineStart}-${selection.lineEnd}`

  return `<selection source="${escapeMarkup(selection.source)}" lines="${lines}">`
}

function escapeMarkup(text: string) {
  return text.replace(/["&<>]/g, (character) => ESCAPES[character] ?? character)
}

/**
 * One pass, so text that was literally `&lt;` before capture comes back as
 * `&lt;` rather than being unescaped a second time into `<`.
 */
function unescapeMarkup(text: string) {
  return text.replace(ESCAPED_PATTERN, (match, entity: string) => UNESCAPES[entity] ?? match)
}
