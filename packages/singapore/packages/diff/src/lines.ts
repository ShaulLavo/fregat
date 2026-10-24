import { hasByteOrderMark, normalizeLineEndings } from '@singapore-editor/core/document'

const CARRIAGE_RETURN = 0x0d

/**
 * A side's lines as git splits them, each held the way the editor ingests that file: its byte order
 * mark goes, and a line keeps its other terminators as the LF the editor reads them as.
 */
export function splitTextLines(text: string): readonly string[] {
  if (text.length === 0) return []
  const body = hasByteOrderMark(text) ? text.slice(1) : text
  const lines = body.split('\n')
  if (normalizeLineEndings(body) === body) return lines
  return lines.map((line, index) => editorLineText(line, index < lines.length - 1))
}

/**
 * One git line as an opened document holds it. With `terminated`, an LF followed it, and ingestion
 * folds a CR just before that LF into it as a CRLF; any other CR, U+2028 or U+2029 is a break.
 */
export function editorLineText(line: string, terminated: boolean): string {
  const crlf = terminated && line.charCodeAt(line.length - 1) === CARRIAGE_RETURN
  return normalizeLineEndings(crlf ? line.slice(0, -1) : line)
}

/** A side's first line: the editor drops one byte order mark from the start of a file. */
export function firstLineText(line: string): string {
  return hasByteOrderMark(line) ? line.slice(1) : line
}

/**
 * The text a host pushes into a diff editor so that it holds exactly the rows joined by LF. The
 * editor drops one leading byte order mark as it ingests, so a first row starting with one gets
 * another in front to spend.
 */
export function joinRenderLines(rows: readonly { readonly text: string }[]): string {
  const text = rows.map((row) => row.text).join('\n')
  return hasByteOrderMark(text) ? `\uFEFF${text}` : text
}

export function normalizeContextLines(value: number | undefined): number {
  if (value === undefined) return 3
  if (!Number.isFinite(value)) return 3
  return Math.max(0, Math.floor(value))
}

export function stripDiffPathPrefix(path: string | undefined): string {
  if (!path) return ''
  if (path === '/dev/null') return path
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

export function languageIdForPath(path: string): string | null {
  const extension = pathExtension(path)
  if (!extension) return null

  return LANGUAGE_BY_EXTENSION[extension] ?? null
}

function pathExtension(path: string): string {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return fileName.slice(dotIndex).toLowerCase()
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.cjs': 'javascript',
  '.css': 'css',
  '.cts': 'typescript',
  '.htm': 'html',
  '.html': 'html',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
}
