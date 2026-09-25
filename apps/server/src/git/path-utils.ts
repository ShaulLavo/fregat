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

export function unquoteGitPath(value: string) {
  if (!value.startsWith('"')) return value

  try {
    return JSON.parse(value) as string
  } catch {
    return value.slice(1, -1)
  }
}

export function ensureTrailingNewline(value: string) {
  return value.endsWith('\n') ? value : `${value}\n`
}
