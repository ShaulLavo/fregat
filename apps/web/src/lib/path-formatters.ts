/**
 * Last path segment, falling back to `'Root'` for an empty or `/`-only path.
 *
 * Five other `basename`-shaped helpers exist in this app and they are NOT
 * copies — do not merge them into this one. They differ in ways this signature
 * cannot express: `features/editor/utils/file-path.ts` lowercases (it feeds
 * extension lookup), `lib/file-icons.ts` falls back to the whole path,
 * `components/utils/picked-path.ts` normalises Windows separators, and
 * `features/terminal/utils/links.ts` + `features/chat/utils/markdown-file-links.ts`
 * return `''` rather than `'Root'`. Every one of them is `(string) => string`,
 * so a wrong swap typechecks and ships.
 */
export function basename(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? 'Root'
}

/**
 * The directory a path sits in, or `''` for a bare name. `'/a/b'` gives `'/a'`.
 *
 * `features/file-picker/model.ts` has a `parentPath` with the same signature
 * that is NOT this one: it splits on `filter(Boolean)` and rejoins, so it drops
 * the leading slash (`'/a/b'` gives `'a'`) and collapses repeated separators.
 * Leave it there.
 */
export function parentPath(path: string) {
  const index = path.lastIndexOf('/')
  if (index < 0) return ''

  return path.slice(0, index)
}

export function displayPath(path: string) {
  if (!path) return '/'

  return `/${path}`
}

export function formatSize(size: number) {
  if (size === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 3)
  const value = size / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function toTreePath(path: string, rootPath: string) {
  if (path === rootPath) return basename(path)
  if (!rootPath) return path
  if (!path.startsWith(`${rootPath}/`)) return path

  return path.slice(rootPath.length + 1)
}

export function canonicalTreePath(path: string) {
  return path.replace(/\/+$/u, '')
}
