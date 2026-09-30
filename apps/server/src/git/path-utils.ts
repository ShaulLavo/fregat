import path from 'node:path'
import { workspaceSearchGlobPath } from '@workspace/contracts'
import { FsError } from '../fs/errors'
import { isOutsideRoot, toPosix } from '../fs/path'
import type { GitPathsBody } from './contracts'

export function mutationPaths(body: GitPathsBody) {
  if (body.paths.length > 0) return body.paths

  throw new FsError('INVALID_PATH')
}

export function pathspecArgs(pathspec: string | null) {
  if (!pathspec) return []

  return ['--', pathspec]
}

export function splitFields(record: string, count: number) {
  const fields: string[] = []
  let cursor = 0

  for (let field = 1; field < count; field += 1) {
    const index = record.indexOf(' ', cursor)
    if (index < 0) return fields.concat(record.slice(cursor))

    fields.push(record.slice(cursor, index))
    cursor = index + 1
  }

  fields.push(record.slice(cursor))
  return fields
}

export function joinPath(rootPath: string, childPath: string | undefined) {
  if (!childPath) return rootPath
  if (!rootPath) return childPath

  return `${rootPath}/${childPath}`
}

export function repositoryRelativePath(rootPath: string, filePath: string) {
  return workspaceSearchGlobPath(rootPath, filePath)
}

/** Posix path from `root` down to `candidate`: `''` for the root itself, null when it escapes. */
export function relativeInsideRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (isOutsideRoot(relative)) return null

  return toPosix(relative)
}

const GIT_ESCAPE_BYTES: Record<string, number> = {
  '"': 0x22,
  '\\': 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
}
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/** Decodes git's C-style quoting, whose `\ooo` escapes are UTF-8 bytes (JSON cannot read them). */
export function unquoteGitPath(value: string) {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value

  const parts = value.slice(1, -1).split(/(\\[0-7]{3}|\\.)/)
  const bytes = parts.flatMap((part) =>
    part.startsWith('\\') ? [gitEscapeByte(part)] : [...utf8Encoder.encode(part)],
  )
  return utf8Decoder.decode(new Uint8Array(bytes))
}

function gitEscapeByte(escape: string) {
  if (escape.length === 4) return Number.parseInt(escape.slice(1), 8)

  const char = escape.slice(1)
  return GIT_ESCAPE_BYTES[char] ?? char.charCodeAt(0)
}

export function ensureTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`
}
