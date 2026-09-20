/**
 * The composer's mention grammar.
 *
 * A mention used to be written as raw `@${path} `, which is not a grammar: a
 * path containing a space produced text nobody could read back, so no surface
 * could ever turn a mention into a chip. This module is the single definition
 * of how a mention is written and how it is found again — the editor renders
 * chips from it, and anything that has to re-read a sent prompt parses with it.
 *
 * Quoting rules: a path that contains nothing ambiguous is written bare, and
 * anything else is written between double quotes with `\` escapes. Inside the
 * quotes `\\` is a backslash, `\"` a quote, and `\n` a newline — so a token
 * never spans a line and can always be found again by scanning one line.
 */

export type ComposerMentionToken = {
  readonly end: number
  readonly path: string
  readonly source: string
  readonly start: number
}

export type ComposerPromptSegment =
  | { readonly path: string; readonly source: string; readonly type: 'mention' }
  | { readonly text: string; readonly type: 'text' }

/** A mention the caret is still inside, and the path typed so far. */
export type ComposerMentionQuery = {
  readonly query: string
  readonly start: number
}

/** Nothing here can end a token, re-open one, or need escaping. */
const BARE_COMPOSER_MENTION_PATH = /^[^\s@"\\]+$/
const BARE_COMPOSER_MENTION_QUERY = /^[^\s@"\\]*$/

type QuotedMentionScan = {
  readonly closed: boolean
  readonly end: number
  readonly path: string
}

type MentionPathScan = {
  readonly end: number
  readonly path: string
}

export function serializeComposerMention(path: string) {
  if (BARE_COMPOSER_MENTION_PATH.test(path)) return `@${path}`

  return `@"${escapeComposerMentionPath(path)}"`
}

/** The exact inverse of `serializeComposerMention`, or `null` for non-mentions. */
export function parseComposerMention(source: string) {
  const token = readComposerMentionAt(source, 0)
  if (!token) return null
  if (token.end !== source.length) return null

  return token.path
}

export function collectComposerMentions(text: string): readonly ComposerMentionToken[] {
  const tokens: ComposerMentionToken[] = []
  let index = 0

  while (index < text.length) {
    const token = readComposerMentionAt(text, index)
    if (!token) {
      index += 1
      continue
    }

    tokens.push(token)
    index = token.end
  }

  return tokens
}

/** The prompt as alternating prose and mentions — what a chip renderer walks. */
export function splitComposerPrompt(text: string): readonly ComposerPromptSegment[] {
  const segments: ComposerPromptSegment[] = []
  let cursor = 0

  for (const token of collectComposerMentions(text)) {
    if (token.start > cursor) segments.push({ text: text.slice(cursor, token.start), type: 'text' })
    segments.push({ path: token.path, source: token.source, type: 'mention' })
    cursor = token.end
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), type: 'text' })

  return segments
}

/**
 * The mention being typed at the caret, if any. A quoted path keeps the trigger
 * alive across the spaces inside it, which is the whole reason the grammar
 * exists: `@"src/my fi` is still one unfinished mention, not two words.
 */
export function activeComposerMention(
  text: string,
  cursorInput: number,
): ComposerMentionQuery | null {
  const cursor = clampComposerCursor(text, cursorInput)
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1

  for (let index = cursor - 1; index >= lineStart; index -= 1) {
    if (text[index] !== '@') continue
    if (!startsComposerToken(text, index)) continue

    const query = activeComposerMentionQuery(text.slice(index + 1, cursor))
    if (query === null) continue

    return { query, start: index }
  }

  return null
}

function escapeComposerMentionPath(path: string) {
  return path.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')
}

function readComposerMentionAt(text: string, start: number): ComposerMentionToken | null {
  if (text[start] !== '@') return null
  if (!startsComposerToken(text, start)) return null

  const body = readComposerMentionPath(text, start + 1)
  if (!body?.path) return null
  if (!isComposerTokenBoundary(text[body.end])) return null

  return { end: body.end, path: body.path, source: text.slice(start, body.end), start }
}

function readComposerMentionPath(text: string, from: number): MentionPathScan | null {
  if (text[from] !== '"') return readBareComposerMentionPath(text, from)

  const scan = scanQuotedComposerMentionPath(text, from + 1)
  if (!scan?.closed) return null

  return { end: scan.end, path: scan.path }
}

function readBareComposerMentionPath(text: string, from: number): MentionPathScan | null {
  let index = from
  while (index < text.length && !endsBareComposerMentionPath(text[index])) {
    index += 1
  }
  if (index === from) return null

  return { end: index, path: text.slice(from, index) }
}

/** `null` only when the quotes ran into a line break, which no token may cross. */
function scanQuotedComposerMentionPath(text: string, from: number): QuotedMentionScan | null {
  let path = ''
  let index = from

  while (index < text.length) {
    const char = text[index] ?? ''
    if (char === '\n') return null
    if (char === '"') return { closed: true, end: index + 1, path }
    if (char !== '\\') {
      path += char
      index += 1
      continue
    }

    const escaped = text[index + 1]
    if (escaped === undefined) break

    path += escaped === 'n' ? '\n' : escaped
    index += 2
  }

  return { closed: false, end: text.length, path }
}

function activeComposerMentionQuery(typed: string) {
  if (!typed.startsWith('"')) return BARE_COMPOSER_MENTION_QUERY.test(typed) ? typed : null

  const scan = scanQuotedComposerMentionPath(typed, 1)
  // A closed quote is a finished mention, so the caret is past it, not inside.
  if (!scan || scan.closed) return null

  return scan.path
}

function startsComposerToken(text: string, index: number) {
  if (index === 0) return true

  return isComposerTokenBoundary(text[index - 1])
}

function endsBareComposerMentionPath(char: string | undefined) {
  if (char === '"' || char === '@' || char === '\\') return true

  return isComposerTokenBoundary(char)
}

function isComposerTokenBoundary(char: string | undefined) {
  return char === undefined || char === ' ' || char === '\n' || char === '\r' || char === '\t'
}

export function clampComposerCursor(text: string, cursorInput: number) {
  if (!Number.isFinite(cursorInput)) return text.length

  return Math.max(0, Math.min(text.length, Math.floor(cursorInput)))
}
