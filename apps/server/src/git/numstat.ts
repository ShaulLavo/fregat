import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { GitFileStatus, GitLineStat } from './types'
import { joinPath } from './path-utils'

const UNTRACKED_MAX_FILES = 200
const UNTRACKED_MAX_BYTES = 512 * 1024
const NUL = 0
const NEWLINE = 10

/** Parses `git diff --numstat -z`. Binary files report `-` and get no entry. */
export function parseNumstat(output: string, rootPath: string) {
  const stats = new Map<string, GitLineStat>()
  const records = output.split('\0')

  for (let index = 0; index < records.length; index += 1) {
    const [additions, deletions, inlinePath] = (records[index] ?? '').split('\t')
    if (additions === undefined || deletions === undefined || inlinePath === undefined) continue

    // A rename leaves the path field empty and follows with old and new paths.
    const renamed = inlinePath === ''
    const filePath = renamed ? records[index + 2] : inlinePath
    if (renamed) index += 2
    if (!filePath || additions === '-') continue

    stats.set(joinPath(rootPath, filePath), {
      additions: Number(additions),
      deletions: Number(deletions),
    })
  }

  return stats
}

export function withLineStats(
  files: readonly GitFileStatus[],
  staged: ReadonlyMap<string, GitLineStat>,
  worktree: ReadonlyMap<string, GitLineStat>,
): GitFileStatus[] {
  return files.map((file) => {
    const lines = { staged: staged.get(file.path), worktree: worktree.get(file.path) }
    if (!lines.staged && !lines.worktree) return file

    return { ...file, lines }
  })
}

/** numstat never sees untracked files, so their lines are counted from disk. */
export async function untrackedLineStats(
  files: readonly GitFileStatus[],
  rootPath: string,
  rootAbsolutePath: string,
) {
  const untracked = files
    .filter((file) => file.status === 'untracked')
    .slice(0, UNTRACKED_MAX_FILES)
  const entries = await Promise.all(
    untracked.map(async (file) => {
      const relative = rootPath ? file.path.slice(rootPath.length + 1) : file.path
      const additions = await countLines(path.join(rootAbsolutePath, relative))
      return [file.path, additions] as const
    }),
  )
  const stats = new Map<string, GitLineStat>()

  for (const [filePath, additions] of entries) {
    if (additions === null) continue

    stats.set(filePath, { additions, deletions: 0 })
  }

  return stats
}

async function countLines(absolutePath: string) {
  const info = await stat(absolutePath).catch(() => null)
  if (!info?.isFile() || info.size > UNTRACKED_MAX_BYTES) return null
  if (info.size === 0) return 0

  const bytes = await readFile(absolutePath).catch(() => null)
  if (!bytes || bytes.includes(NUL)) return null

  let lines = bytes[bytes.length - 1] === NEWLINE ? 0 : 1
  for (const byte of bytes) {
    if (byte === NEWLINE) lines += 1
  }

  return lines
}
