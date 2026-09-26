import { createHash } from 'node:crypto'
import { ensureTrailingNewline, joinPath, unquoteGitPath } from './path-utils'
import type { GitDiffHunk, GitFileDiff, GitLineChange } from './types'

const HUNK_HEADER_PATTERN =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldLines>\d+))? \+(?<newStart>\d+)(?:,(?<newLines>\d+))? @@/

export function parseDiff(output: string, rootPath: string, staged: boolean) {
  const diffs: MutableGitFileDiff[] = []
  let current: MutableGitFileDiff | null = null
  let hunk: MutableGitDiffHunk | null = null

  for (const line of diffLines(output)) {
    if (line.startsWith('diff --git ')) {
      current = startDiffFile(diffs, rootPath, staged, line)
      hunk = null
      continue
    }
    if (!current) continue

    current.lines.push(line)
    applyDiffMetadata(current, rootPath, line)
    if (line.startsWith('@@ ')) {
      hunk = startDiffHunk(current, line)
      continue
    }
    if (!hunk) continue

    applyDiffLine(hunk, line)
  }

  return diffs.map(finalizeDiff)
}

function applyDiffMetadata(current: MutableGitFileDiff, rootPath: string, line: string) {
  if (line.startsWith('rename from ')) current.oldPath = joinPath(rootPath, line.slice(12))
  if (line.startsWith('rename to ')) current.path = joinPath(rootPath, line.slice(10))
  if (line === '--- /dev/null') current.oldFileMissing = true
  if (line.startsWith('--- ')) current.oldPath = diffPath(rootPath, line, 'a/')
  if (line === '+++ /dev/null') current.newFileMissing = true
  if (line.startsWith('+++ ')) {
    current.path = diffPath(rootPath, line, 'b/') ?? current.path
  }
}

function finalizeDiff(diff: MutableGitFileDiff): GitFileDiff {
  return {
    hunks: diff.hunks.map((hunk) => finalizeHunk(hunk, diff)),
    newFileMissing: diff.newFileMissing,
    oldFileMissing: diff.oldFileMissing,
    oldPath: diff.oldPath === diff.path ? undefined : diff.oldPath,
    patch: ensureTrailingNewline(diff.lines.join('\n')),
    path: diff.path,
    staged: diff.staged,
  }
}

function diffLines(output: string) {
  if (!output) return []
  if (!output.endsWith('\n')) return output.split('\n')

  return output.slice(0, -1).split('\n')
}

type MutableGitFileDiff = {
  path: string
  oldPath?: string
  oldFileMissing?: boolean
  newFileMissing?: boolean
  staged: boolean
  lines: string[]
  hunks: MutableGitDiffHunk[]
}

type MutableGitDiffHunk = Omit<GitDiffHunk, 'id' | 'patch'> & {
  lines: string[]
  oldLine: number
  newLine: number
}

function startDiffFile(
  diffs: MutableGitFileDiff[],
  rootPath: string,
  staged: boolean,
  line: string,
) {
  const path = diffGitPath(line)
  const diff = {
    hunks: [],
    lines: [line],
    path: joinPath(rootPath, path),
    staged,
  }

  diffs.push(diff)
  return diff
}

function startDiffHunk(current: MutableGitFileDiff, line: string) {
  const match = HUNK_HEADER_PATTERN.exec(line)
  const oldStart = Number(match?.groups?.oldStart ?? 0)
  const oldLines = Number(match?.groups?.oldLines ?? 1)
  const newStart = Number(match?.groups?.newStart ?? 0)
  const newLines = Number(match?.groups?.newLines ?? 1)
  const hunk: MutableGitDiffHunk = {
    changes: [],
    header: line,
    lines: [line],
    newLine: newStart,
    newLines,
    newStart,
    oldLine: oldStart,
    oldLines,
    oldStart,
  }

  current.hunks.push(hunk)
  return hunk
}

function applyDiffLine(hunk: MutableGitDiffHunk, line: string) {
  hunk.lines.push(line)
  if (line.startsWith('\\ No newline')) return

  const type = diffLineType(line)
  if (type === 'added') {
    hunk.changes.push({
      newLine: hunk.newLine,
      oldLine: null,
      text: line.slice(1),
      type,
    })
    hunk.newLine += 1
    return
  }
  if (type === 'deleted') {
    hunk.changes.push({
      newLine: null,
      oldLine: hunk.oldLine,
      text: line.slice(1),
      type,
    })
    hunk.oldLine += 1
    return
  }

  hunk.changes.push({
    newLine: hunk.newLine,
    oldLine: hunk.oldLine,
    text: line.slice(1),
    type,
  })
  hunk.newLine += 1
  hunk.oldLine += 1
}

function finalizeHunk(hunk: MutableGitDiffHunk, diff: MutableGitFileDiff): GitDiffHunk {
  const patch = ensureTrailingNewline(hunk.lines.join('\n'))
  return {
    changes: hunk.changes,
    id: hunkId(diff.path, diff.oldPath, patch),
    header: hunk.header,
    newLines: hunk.newLines,
    newStart: hunk.newStart,
    oldLines: hunk.oldLines,
    oldStart: hunk.oldStart,
    patch,
  }
}

// The same refs and flags print byte-identical hunks, so this survives a re-read of a turn.
function hunkId(path: string, oldPath: string | undefined, patch: string) {
  return createHash('sha256')
    .update(`${path}\0${oldPath ?? path}\0${patch}`)
    .digest('hex')
    .slice(0, 16)
}

function diffLineType(line: string): GitLineChange['type'] {
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'deleted'

  return 'context'
}

export function rewriteBlobPatchPaths(
  patch: string,
  input: {
    newObjectId?: string
    oldObjectId?: string
    oldPath: string
    path: string
  },
) {
  const oldPath = `a/${input.oldPath}`
  const newPath = `b/${input.path}`
  const lines = diffLines(patch).map((line) =>
    rewriteBlobPatchLine(line, { ...input, newPath, oldPath }),
  )

  if (lines.length === 0) return ''

  return ensureTrailingNewline(lines.join('\n'))
}

function rewriteBlobPatchLine(
  line: string,
  input: {
    newObjectId?: string
    newPath: string
    oldObjectId?: string
    oldPath: string
    path: string
  },
) {
  if (line.startsWith('diff --git ')) {
    return `diff --git ${input.oldPath} ${input.newPath}`
  }
  if (line.startsWith('--- ')) {
    return input.oldObjectId ? `--- ${input.oldPath}` : '--- /dev/null'
  }
  if (line.startsWith('+++ ')) {
    return input.newObjectId ? `+++ ${input.newPath}` : '+++ /dev/null'
  }

  return line
}

function diffGitPath(line: string) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
  return unquoteGitPath(match?.[2] ?? '')
}

function diffPath(rootPath: string, line: string, prefix: 'a/' | 'b/') {
  const value = line.slice(4)
  if (value === '/dev/null') return undefined
  if (!value.startsWith(prefix)) return undefined

  return joinPath(rootPath, unquoteGitPath(value.slice(2)))
}
