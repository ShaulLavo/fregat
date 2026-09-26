import type { GitFileDiff } from '@workspace/contracts'
import { createTextDiff, parseGitPatch, type DiffFile, type DiffHunk } from '@singapore-editor/diff'

type LanguageResolver = (path: string) => string | null

/**
 * `text` recomputes hunks from the complete sources. `patch` keeps the server's hunks over them,
 * because a checkpoint patch carries its own whitespace policy.
 */
export type DiffHunkSource = 'patch' | 'text'

export function editorDiffFiles(
  diffs: readonly GitFileDiff[],
  language?: LanguageResolver,
  hunks: DiffHunkSource = 'text',
): DiffFile[] {
  return diffs.flatMap((diff) => toEditorDiffFiles(diff, hunks, language))
}

export function renderableDiffFile(files: readonly DiffFile[]): DiffFile | null {
  return files.find((file) => file.hunks.length > 0) ?? files.find(hasWholeFileText) ?? null
}

function hasWholeFileText(file: DiffFile) {
  if (file.isPartial) return false

  return file.newLines.length > 0 || file.oldLines.length > 0
}

function toEditorDiffFiles(
  diff: GitFileDiff,
  hunks: DiffHunkSource,
  language?: LanguageResolver,
): DiffFile[] {
  // Without both sources a patch is only the lines git printed, and stays marked partial.
  if (!hasCompleteSources(diff)) {
    return parseGitPatch(diff.patch, { cacheKey: diffCacheKey(diff) }).map((file) => ({
      ...file,
      ...entryPaths(diff),
    }))
  }
  if (hunks === 'patch' && diff.hunks.length > 0) return patchOverSources(diff, language)

  return [
    createTextDiff({
      newFile: newSide(diff, language),
      oldFile: oldSide(diff, language),
    }),
  ]
}

/** Every side that exists carries its text; a missing side is the only empty one. */
function hasCompleteSources(diff: GitFileDiff) {
  if (!diff.oldFileMissing && diff.oldText === undefined) return false

  return Boolean(diff.newFileMissing) || diff.newText !== undefined
}

function patchOverSources(diff: GitFileDiff, language?: LanguageResolver): DiffFile[] {
  const newLines = sourceLines(diff.newFileMissing ? '' : diff.newText)
  const oldSource = sourceLines(diff.oldFileMissing ? '' : diff.oldText)

  return parseGitPatch(diff.patch, { cacheKey: diffCacheKey(diff) }).map((file) => ({
    ...file,
    ...entryPaths(diff),
    isPartial: false,
    languageId: language?.(diff.path) ?? file.languageId,
    newLines,
    oldLines: oldLinesAsDrawn(oldSource, file.hunks),
  }))
}

/** The server roots its paths; the patch header holds repo-relative ones. */
function entryPaths(diff: GitFileDiff) {
  return { newPath: diff.path, oldPath: diff.oldPath ?? diff.path, path: diff.path }
}

/**
 * Under `--ignore-all-space` git prints a whitespace-only context line with its new text, and the
 * split view's old pane draws that text, so the old source carries it for that row's tokens.
 */
function oldLinesAsDrawn(oldLines: readonly string[], hunks: readonly DiffHunk[]) {
  let drawn: string[] | null = null
  for (const line of hunks.flatMap((hunk) => hunk.lines)) {
    const index = (line.oldLineNumber ?? 0) - 1
    if (line.type !== 'context' || oldLines[index] === undefined) continue
    if (oldLines[index] === line.text) continue

    drawn ??= [...oldLines]
    drawn[index] = line.text
  }

  return drawn ?? oldLines
}

/** The split `createTextDiff` uses, so both hunk sources index the same line arrays. */
function sourceLines(text: string | undefined): readonly string[] {
  if (!text) return []

  return text.split('\n')
}

function oldSide(diff: GitFileDiff, language?: LanguageResolver) {
  if (diff.oldFileMissing) return null

  const path = diff.oldPath ?? diff.path
  return {
    languageId: language?.(path),
    objectId: diff.oldObjectId,
    path,
    text: diff.oldText ?? '',
  }
}

function newSide(diff: GitFileDiff, language?: LanguageResolver) {
  if (diff.newFileMissing) return null

  return {
    languageId: language?.(diff.path),
    objectId: diff.newObjectId,
    path: diff.path,
    text: diff.newText ?? '',
  }
}

function diffCacheKey(diff: GitFileDiff) {
  return `${diff.oldObjectId ?? ''}:${diff.newObjectId ?? ''}:${diff.path}`
}
