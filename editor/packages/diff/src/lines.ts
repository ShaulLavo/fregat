const CARRIAGE_RETURN = 0x0d
const BYTE_ORDER_MARK = 0xfeff

/**
 * A text's lines as git splits them, holding what the editor keeps of each: a host pushes rows into
 * an editor that drops a leading byte order mark and folds a CR ending a line into its break.
 */
export function splitTextLines(text: string): readonly string[] {
  if (text.length === 0) return []
  const lines = text.includes('\r') ? text.split('\n').map(lineText) : text.split('\n')
  lines[0] = firstLineText(lines[0]!)
  return lines
}

/** A line without the CRs that end it, the CR of a CRLF among them. */
export function lineText(line: string): string {
  let end = line.length
  while (end > 0 && line.charCodeAt(end - 1) === CARRIAGE_RETURN) end -= 1
  return end === line.length ? line : line.slice(0, end)
}

export function firstLineText(line: string): string {
  return line.charCodeAt(0) === BYTE_ORDER_MARK ? line.slice(1) : line
}

export function joinRenderLines(rows: readonly { readonly text: string }[]): string {
  return rows.map((row) => row.text).join('\n')
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
