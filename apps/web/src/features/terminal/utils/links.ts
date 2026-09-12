import {
  resolveInlineCodeFileReference,
  type MarkdownFileReference,
} from '@/features/chat/utils/markdown-file-links'
import type { LinkLineSnapshot } from 'ghostty-webgpu'

/**
 * The slice of ghostty's `IBufferLine` link detection reads — the cell-level
 * shape its own URL provider uses, plus the wrap flag. Structural rather than
 * the interface itself so detection can be exercised without a WASM terminal.
 */
export type TerminalBufferLine = {
  readonly getCell: (x: number) => { readonly getCodepoint: () => number } | undefined
  /** True when this row continues the row above it. */
  readonly isWrapped: boolean
  readonly length: number
}

export type TerminalBufferLineReader = (row: number) => TerminalBufferLine | undefined

/** Inclusive at both ends and 0-based: the coordinates ghostty's `ILink` wants. */
type TerminalLinkRange = {
  readonly end: TerminalBufferPosition
  readonly start: TerminalBufferPosition
}

export type TerminalPathLink = {
  readonly range: TerminalLinkRange
  readonly reference: MarkdownFileReference
  readonly text: string
}

export type TerminalSnapshotPathLink = {
  readonly range: { readonly end: number; readonly start: number }
  readonly reference: MarkdownFileReference
  readonly text: string
}

type TerminalBufferPosition = {
  readonly x: number
  readonly y: number
}

type TerminalPathMatch = {
  readonly end: number
  readonly start: number
  readonly text: string
}

/** A token narrowed to its path part, with how far into the token that part sits. */
type PathCandidate = {
  readonly shift: number
  readonly text: string
}

type WrappedTerminalLine = {
  readonly segments: readonly WrappedTerminalLineSegment[]
  readonly text: string
}

type WrappedTerminalLineSegment = {
  readonly endIndex: number
  readonly row: number
  readonly startIndex: number
  readonly text: string
}

/**
 * Ends a token. Whitespace plus the wrappers terminals print around paths, so
 * `at run (/abs/x.ts:9)` yields the path and not the parentheses.
 */
const TOKEN_BOUNDARY = new Set([
  ' ',
  '\t',
  '"',
  "'",
  '`',
  '<',
  '>',
  '|',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
])

/** Prose punctuation that can trail a path: `wrote src/a.ts:12.` */
const TRAILING_PUNCTUATION = new Set(['.', ',', ':', ';', '!', '?'])

/**
 * `scheme://` — ghostty's own URL provider owns those, and this one must not
 * offer a second link over the same cells.
 */
const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:\/\//u

/**
 * POSIX `PATH_MAX`. A longer run is output — a hex dump, a minified bundle, a
 * base64 blob — and cannot name a file, so it is rejected on length alone
 * before any character of it is examined further.
 */
const MAX_CANDIDATE_LENGTH = 1024

const MAX_CODEPOINT = 0x10_ffff

// Allowlist rather than public-suffix detection, and terminal-owned: the shared
// resolver drops its hostname check as soon as a `:number` suffix is present,
// which is fine for prose but turns every `serving example.com:8080` into a
// file at line 8080. Extensions that double as filename suffixes are absent.
const HOSTNAME_TLDS = new Set([
  'ai',
  'app',
  'biz',
  'cloud',
  'co',
  'com',
  'dev',
  'edu',
  'gov',
  'info',
  'io',
  'me',
  'net',
  'org',
  'site',
  'tech',
  'xyz',
])

/**
 * Every file reference on the logical line that `row` belongs to.
 *
 * A terminal token is a whitespace-delimited literal, the same thing an inline
 * code span in a transcript is, so which candidates are really files — and how a
 * relative one resolves — stays with the shared resolver instead of becoming a
 * second policy that drifts from it. What terminals print and transcripts do not
 * (user agents, host:port pairs, `ERROR:`-prefixed paths) is decided here.
 *
 * Known limitation: a relative path resolves against `rootPath`, the panel's
 * root, because ghostty-webgpu reports no OSC 7 cwd. After `cd apps/web`, output
 * saying `src/foo.ts:3` means `<root>/apps/web/src/foo.ts` and this resolves it
 * to `<root>/src/foo.ts`. Nothing here can tell the two apart, so the click path
 * (`use-terminal-links.ts`) stats the file and surfaces a not-found error rather
 * than opening a tab on a path that does not exist.
 */
export function readTerminalPathLinks({
  getLine,
  rootPath,
  row,
}: {
  readonly getLine: TerminalBufferLineReader
  readonly rootPath: string | null
  readonly row: number
}): TerminalPathLink[] {
  const line = collectWrappedLine(row, getLine)
  if (!line) return []

  const links: TerminalPathLink[] = []
  for (const match of pathMatches(line.text)) {
    const reference = resolveInlineCodeFileReference(match.text, rootPath)
    if (!reference) continue

    links.push({ range: linkRange(line, match), reference, text: match.text })
  }

  return links
}

/** Native link providers resolve one rendered row at a time. */
export function readTerminalSnapshotPathLinks({
  line,
  rootPath,
}: {
  readonly line: LinkLineSnapshot
  readonly rootPath: string | null
}): TerminalSnapshotPathLink[] {
  const links: TerminalSnapshotPathLink[] = []
  for (const match of pathMatches(line.text)) {
    const reference = resolveInlineCodeFileReference(match.text, rootPath)
    if (!reference) continue

    const start = line.startCellByTextBoundary[match.start]
    const end = line.endCellByTextBoundary[match.end]
    if (start === undefined || end === undefined) continue
    links.push({ range: { end, start }, reference, text: match.text })
  }
  return links
}

/**
 * Rebuilds the logical line the row belongs to. A path the emulator soft-wrapped
 * is still one path, and a detector that reads a single row only ever sees the
 * two halves — neither of which looks like a file.
 */
function collectWrappedLine(
  row: number,
  getLine: TerminalBufferLineReader,
): WrappedTerminalLine | null {
  const anchor = getLine(row)
  if (!anchor) return null

  const segments: WrappedTerminalLineSegment[] = []
  let current = firstRowOfWrappedLine(row, anchor, getLine)
  let startIndex = 0

  while (true) {
    const line = getLine(current)
    if (!line) break

    const text = bufferLineText(line)
    segments.push({ endIndex: startIndex + text.length, row: current, startIndex, text })
    startIndex += text.length

    if (!getLine(current + 1)?.isWrapped) break
    current += 1
  }

  return { segments, text: segments.map((segment) => segment.text).join('') }
}

function firstRowOfWrappedLine(
  row: number,
  anchor: TerminalBufferLine,
  getLine: TerminalBufferLineReader,
) {
  let first = row
  let line = anchor

  while (first > 0 && line.isWrapped) {
    const previous = getLine(first - 1)
    if (!previous) break

    first -= 1
    line = previous
  }

  return first
}

/**
 * Blank and control cells become spaces so a character index is also a column:
 * ghostty's `translateToString` drops them, which slides every later column left
 * and puts the link's range on the wrong cells.
 */
function bufferLineText(line: TerminalBufferLine) {
  const characters: string[] = []

  for (let x = 0; x < line.length; x += 1) {
    const codepoint = line.getCell(x)?.getCodepoint() ?? 0
    if (codepoint < 32 || codepoint > MAX_CODEPOINT) {
      characters.push(' ')
      continue
    }

    characters.push(String.fromCodePoint(codepoint))
  }

  return characters.join('')
}

/**
 * Splits the line into tokens and asks each one whether it is a path.
 *
 * A regex alternation of unanchored `[^delimiter]*` prefixes is quadratic on
 * exactly the output terminals produce most of — one long run with no delimiter
 * in it — because the engine re-scans to the end from every start index. The
 * whole provider runs synchronously inside ghostty's mousemove handler, so the
 * scan is a single left-to-right pass instead: each character is visited once,
 * and no pattern ever runs over more than `MAX_CANDIDATE_LENGTH` characters.
 */
function pathMatches(text: string): TerminalPathMatch[] {
  const matches: TerminalPathMatch[] = []
  let index = 0

  while (index < text.length) {
    if (TOKEN_BOUNDARY.has(text[index] ?? '')) {
      index += 1
      continue
    }

    const end = tokenEnd(text, index)
    const match = pathMatch(text.slice(index, end), index)
    index = end

    if (match) matches.push(match)
  }

  return matches
}

function tokenEnd(text: string, start: number) {
  let end = start
  while (end < text.length && !TOKEN_BOUNDARY.has(text[end] ?? '')) {
    end += 1
  }

  return end
}

function pathMatch(token: string, offset: number): TerminalPathMatch | null {
  if (token.length > MAX_CANDIDATE_LENGTH) return null
  if (URL_SCHEME.test(token)) return null

  const trimmed = withoutTrailingPunctuation(token)
  if (trimmed.length === 0) return null

  const candidate = withoutDiagnosticLabel(trimmed)
  if (!isPathShaped(candidate.text)) return null

  const start = offset + candidate.shift

  return { end: start + candidate.text.length, start, text: candidate.text }
}

function withoutTrailingPunctuation(token: string) {
  let end = token.length
  while (end > 0 && TRAILING_PUNCTUATION.has(token[end - 1] ?? '')) {
    end -= 1
  }

  return token.slice(0, end)
}

/**
 * `ERROR:src/a.ts:1` — a log level glued to the path. The shared resolver reads
 * that prefix as a URL scheme and drops the whole token, so the label is peeled
 * off here. Only a prefix with no dot and no slash can be a label, which leaves
 * `src/a.ts:1` and `example.com:8080` whole; and because the remainder is a
 * guess it has to name a file with an extension, which is what separates a path
 * from a module specifier like `node:internal/main:22:3`.
 */
function withoutDiagnosticLabel(token: string): PathCandidate {
  const colon = token.indexOf(':')
  if (colon <= 0) return { shift: 0, text: token }

  const label = token.slice(0, colon)
  if (label.includes('.') || label.includes('/')) return { shift: 0, text: token }

  const rest = token.slice(colon + 1)
  if (!hasExtension(basename(withoutPosition(rest)))) return { shift: 0, text: token }

  return { shift: colon + 1, text: rest }
}

function isPathShaped(candidate: string) {
  const bare = withoutPosition(candidate)
  if (bare.length === 0) return false
  if (looksLikeHostname(bare)) return false

  return !hasNumericExtension(basename(bare))
}

/** `example.com:8080`, `example.dev/guide.ts:3` — a host, whatever trails it. */
function looksLikeHostname(bare: string) {
  if (bare.startsWith('/')) return false

  const slash = bare.indexOf('/')
  const host = slash < 0 ? bare : bare.slice(0, slash)
  const labels = host.toLowerCase().split('.')
  if (labels.length < 2) return false

  return HOSTNAME_TLDS.has(labels[labels.length - 1] ?? '')
}

/**
 * `Mozilla/5.0`, `Safari/537.36`, `node/v18.2.0` — the trailing `.42` is a
 * version, not an extension, and terminal banners are full of them. Anything
 * genuinely named `.1` (a rotated log, a core dump) is not editor material.
 */
function hasNumericExtension(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false

  const extension = name.slice(dot + 1)
  if (extension.length === 0) return false

  return !/\D/u.test(extension)
}

function hasExtension(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false

  return dot < name.length - 1
}

/** Drops a `:line[:column]` suffix, the same pair the shared resolver reads. */
function withoutPosition(candidate: string) {
  return withoutNumericSuffix(withoutNumericSuffix(candidate))
}

function withoutNumericSuffix(candidate: string) {
  const colon = candidate.lastIndexOf(':')
  if (colon <= 0) return candidate

  const digits = candidate.slice(colon + 1)
  if (digits.length === 0) return candidate
  if (/\D/u.test(digits)) return candidate

  return candidate.slice(0, colon)
}

function basename(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

function linkRange(line: WrappedTerminalLine, match: TerminalPathMatch): TerminalLinkRange {
  return {
    end: bufferPosition(line.segments, match.end - 1),
    start: bufferPosition(line.segments, match.start),
  }
}

function bufferPosition(
  segments: readonly WrappedTerminalLineSegment[],
  index: number,
): TerminalBufferPosition {
  for (const segment of segments) {
    if (index >= segment.endIndex) continue

    return { x: index - segment.startIndex, y: segment.row }
  }

  const last = segments[segments.length - 1]
  return { x: Math.max(0, (last?.text.length ?? 1) - 1), y: last?.row ?? 0 }
}
