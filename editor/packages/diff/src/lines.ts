export function splitTextLines(text: string): readonly string[] {
  if (text.length === 0) return []
  return text.split('\n')
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
