export type MarkdownPreviewTarget =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'anchor'; readonly href: string }
  | { readonly kind: 'external'; readonly href: string }
  | { readonly kind: 'file'; readonly path: string }

/**
 * What a link or image in a rendered markdown file points at: another workspace file, resolved
 * from the file's own folder (a leading slash means the workspace root), or somewhere outside.
 */
export function markdownPreviewTarget(
  href: string,
  documentPath: string,
  rootPath: string,
): MarkdownPreviewTarget {
  if (href.startsWith('#')) return { kind: 'anchor', href }
  if (/^[a-z][a-z\d+.-]*:/iu.test(href) || href.startsWith('//')) return { kind: 'external', href }
  const bare = decodePath(href.replace(/[?#].*$/u, ''))
  const base = bare.startsWith('/')
    ? rootPath
    : documentPath.slice(0, documentPath.lastIndexOf('/'))
  const path = normalizePath(`${base}/${bare}`)
  const root = normalizePath(rootPath)
  if (path === null || root === null || !insideRoot(path, root)) return { kind: 'unavailable' }
  return { kind: 'file', path }
}

function insideRoot(path: string, root: string) {
  if (path === root || root === '') return true
  return path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

function decodePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** Keeps an absolute path absolute; `null` when `..` climbs above the start. */
function normalizePath(path: string) {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') {
      parts.push(part)
      continue
    }
    if (parts.length === 0) return null
    parts.pop()
  }
  const joined = parts.join('/')
  return path.startsWith('/') ? `/${joined}` : joined
}

/** The server URL for a workspace image, or the source untouched when it is already a URL. */
export function markdownPreviewImageSource(
  source: string,
  documentPath: string,
  rootPath: string,
  origin: string,
) {
  const target = markdownPreviewTarget(source, documentPath, rootPath)
  if (target.kind === 'unavailable') return undefined
  if (target.kind !== 'file') return source
  return `${origin.replace(/\/+$/u, '')}/fs/blob?${new URLSearchParams({ path: target.path })}`
}
