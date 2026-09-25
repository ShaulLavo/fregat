export type MarkdownPreviewTarget =
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
  const bare = decodeURIComponent(href.replace(/[?#].*$/u, ''))
  const base = bare.startsWith('/')
    ? rootPath
    : documentPath.slice(0, documentPath.lastIndexOf('/'))
  return { kind: 'file', path: normalizePath(`${base}/${bare}`) }
}

function normalizePath(path: string) {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}

/** The server URL for a workspace image, or the source untouched when it is already a URL. */
export function markdownPreviewImageSource(
  source: string,
  documentPath: string,
  rootPath: string,
  origin: string,
) {
  const target = markdownPreviewTarget(source, documentPath, rootPath)
  if (target.kind !== 'file') return source
  return `${origin.replace(/\/+$/u, '')}/fs/blob?${new URLSearchParams({ path: target.path })}`
}
