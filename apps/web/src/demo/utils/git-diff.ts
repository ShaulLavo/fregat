import type { GitFileDiff, GitLineChange } from '@workspace/contracts'

export function fileDiff(
  path: string,
  before: string | undefined,
  after: string | undefined,
  staged: boolean,
): GitFileDiff {
  const oldLines = (before ?? '').split('\n')
  const newLines = (after ?? '').split('\n')
  const changes: GitLineChange[] = [
    ...oldLines.map((text, index) => ({
      type: 'deleted' as const,
      oldLine: index + 1,
      newLine: null,
      text,
    })),
    ...newLines.map((text, index) => ({
      type: 'added' as const,
      oldLine: null,
      newLine: index + 1,
      text,
    })),
  ]
  const relative = path.replace(/^\/garden\//u, '')
  const header = `@@ -1,${oldLines.length} +1,${newLines.length} @@`
  const patch = `${header}\n${changes.map((line) => `${line.type === 'added' ? '+' : '-'}${line.text}`).join('\n')}\n`
  return {
    path,
    staged,
    oldText: before ?? '',
    newText: after ?? '',
    oldFileMissing: before === undefined,
    newFileMissing: after === undefined,
    patch: `diff --git a/${relative} b/${relative}\n--- a/${relative}\n+++ b/${relative}\n${patch}`,
    hunks: [
      {
        // The demo never undoes a hunk; any id unique to the file will do.
        id: `demo:${relative}`,
        header,
        oldStart: 1,
        oldLines: oldLines.length,
        newStart: 1,
        newLines: newLines.length,
        patch,
        changes,
      },
    ],
  }
}
