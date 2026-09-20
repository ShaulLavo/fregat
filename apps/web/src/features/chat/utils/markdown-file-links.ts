import { workspaceRelativePath } from '@/lib/workspace-relative-path'
import { looksLikeHostname } from '@/lib/hostname'
import { pathLeaf as basename } from '@/lib/path-formatters'
/**
 * Turns the file references agents write in prose — `src/foo.ts:42`,
 * `[foo](src/foo.ts)`, `/abs/path.ts#L12` — into editor-openable targets.
 * The bar for linking is deliberately uneven: an explicit markdown link only
 * has to look like a path, while an inline code span (mostly identifiers,
 * commands and git refs) also needs an extension or a `:line` suffix.
 */

export type MarkdownFileReference = {
  /** Workspace-relative when the path is inside the root, absolute otherwise. */
  readonly label: string
  readonly column: number | null
  readonly line: number | null
  readonly path: string
}

const POSITION_SUFFIX = /:(\d+)(?::(\d+))?$/u
const LINE_HASH = /^#L(\d+)(?:C(\d+))?$/iu
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/u
const RELATIVE_PREFIX = /^(?:~\/|\.{1,2}\/)/u
const FILE_EXTENSION = /\.[A-Za-z0-9_-]+$/u
const INLINE_CODE_DISQUALIFIER = /[\s`]/u
const NUMERIC_DOTTED = /^\d+(?:\.\d+)+$/u

/** Roots that name real filesystems; app routes like `/chat/x` must not link. */
const FILE_ROOT_PREFIXES = [
  '/Users/',
  '/home/',
  '/tmp/',
  '/private/',
  '/var/',
  '/etc/',
  '/opt/',
  '/mnt/',
  '/Volumes/',
  '/root/',
  '/usr/',
  '/srv/',
  '/workspace/',
  '/workspaces/',
] as const

export function resolveMarkdownLinkFileReference(
  href: string | undefined,
  rootPath: string | null,
): MarkdownFileReference | null {
  if (!href) return null

  const destination = unwrapDestination(href.trim())
  if (destination.length === 0) return null
  if (destination.startsWith('#')) return null

  const { hash, path } = splitHash(stripQuery(fileUrlPath(destination) ?? destination))
  const decoded = safeDecode(path)
  if (decoded.length === 0) return null
  if (hasExternalScheme(decoded)) return null

  const position = splitPosition(appendHashPosition(decoded, hash))
  if (!looksLikePath(position.bare)) return null

  return fileReference(position, rootPath)
}

export function resolveInlineCodeFileReference(
  code: string,
  rootPath: string | null,
): MarkdownFileReference | null {
  const candidate = code.trim().replaceAll('\\', '/')
  if (candidate.length === 0) return null
  if (INLINE_CODE_DISQUALIFIER.test(candidate)) return null
  if (hasExternalScheme(candidate)) return null

  const position = splitPosition(candidate)
  const positioned = position.line !== null
  if (!positioned && !candidate.includes('/')) return null
  if (!looksLikePath(position.bare)) return null
  if (isHostnameReference(position.bare.split('/')[0] ?? position.bare, positioned)) return null
  if (!positioned && !FILE_EXTENSION.test(basename(position.bare))) return null

  return fileReference(position, rootPath)
}

type PositionedPath = {
  readonly bare: string
  readonly column: number | null
  readonly line: number | null
}

function splitPosition(candidate: string): PositionedPath {
  const match = candidate.match(POSITION_SUFFIX)
  if (!match) return { bare: candidate, column: null, line: null }

  return {
    bare: candidate.slice(0, candidate.length - match[0].length),
    column: positiveInteger(match[2]),
    line: positiveInteger(match[1]),
  }
}

function fileReference(
  position: PositionedPath,
  rootPath: string | null,
): MarkdownFileReference | null {
  if (position.bare.length === 0) return null

  const absolute = absolutePath(position.bare, rootPath)
  if (!absolute) return null

  return {
    column: position.column,
    label: referenceLabel(absolute, rootPath, position.line, position.column),
    line: position.line,
    path: absolute,
  }
}

function referenceLabel(
  path: string,
  rootPath: string | null,
  line: number | null,
  column: number | null,
) {
  const relative = workspaceRelativePath(path, rootPath) ?? path
  if (line === null) return relative
  if (column === null) return `${relative}:${line}`

  return `${relative}:${line}:${column}`
}

/** Relative references only resolve once we know which project the chat is in. */
function absolutePath(path: string, rootPath: string | null) {
  if (path.startsWith('/')) return normalizeSegments(path)
  if (rootPath === null) return null

  const root = rootPath.replace(/\/+$/u, '')
  const relative = path.replace(RELATIVE_PREFIX, (prefix) => (prefix === '../' ? '../' : ''))

  return normalizeSegments(root ? `${root}/${relative}` : relative)
}

function normalizeSegments(path: string) {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment !== '..') {
      segments.push(segment)
      continue
    }
    segments.pop()
  }

  return `${path.startsWith('/') ? '/' : ''}${segments.join('/')}`
}

function looksLikePath(bare: string) {
  if (RELATIVE_PREFIX.test(bare)) return true
  if (!bare.startsWith('/')) return bare.includes('/') || FILE_EXTENSION.test(bare)
  if (FILE_ROOT_PREFIXES.some((prefix) => bare.startsWith(prefix))) return true

  return FILE_EXTENSION.test(basename(bare))
}

/** `127.0.0.1`, `example.com/x`, `1.2.3` — hosts and versions, not files. */
function isHostnameReference(segment: string, positioned: boolean) {
  if (segment.startsWith('.')) return false
  if (NUMERIC_DOTTED.test(segment)) return true
  if (positioned) return false

  return looksLikeHostname(segment)
}

function hasExternalScheme(path: string) {
  const match = path.match(SCHEME)
  if (!match) return false

  const rest = match[2] ?? ''
  if (rest.startsWith('//')) return true

  return !/^\d+(?::\d+)?$/u.test(rest)
}

function fileUrlPath(destination: string) {
  if (!destination.toLowerCase().startsWith('file:')) return null

  try {
    return new URL(destination).pathname
  } catch {
    return null
  }
}

function appendHashPosition(path: string, hash: string) {
  if (hash.length === 0) return path
  if (POSITION_SUFFIX.test(path)) return path

  const match = hash.match(LINE_HASH)
  if (!match) return path
  if (!match[2]) return `${path}:${match[1]}`

  return `${path}:${match[1]}:${match[2]}`
}

function unwrapDestination(value: string) {
  if (!value.startsWith('<')) return value
  if (!value.endsWith('>')) return value

  return value.slice(1, -1)
}

function splitHash(value: string) {
  const index = value.indexOf('#')
  if (index < 0) return { hash: '', path: value }

  return { hash: value.slice(index), path: value.slice(0, index) }
}

function stripQuery(value: string) {
  const index = value.indexOf('?')
  if (index < 0) return value

  return value.slice(0, index)
}

function positiveInteger(value: string | undefined) {
  if (value === undefined) return null

  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed)) return null
  if (parsed <= 0) return null

  return parsed
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
