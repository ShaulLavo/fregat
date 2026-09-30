import { parsePatch, structuredPatch } from 'diff'
import { annotateInlineChanges } from './inline'
import {
  languageIdForPath,
  normalizeContextLines,
  splitTextLines,
  stripDiffPathPrefix,
} from './lines'
import type {
  CreateTextDiffOptions,
  DiffFile,
  DiffFileChangeType,
  DiffHunk,
  DiffHunkLine,
  DiffTextFile,
  ParseGitPatchOptions,
} from './types'

type ParsedPatchFile = {
  readonly oldFileName?: string
  readonly newFileName?: string
  readonly oldHeader?: string
  readonly newHeader?: string
  readonly hunks?: readonly ParsedPatchHunk[]
}

type ParsedPatchHunk = {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

type GitFileMetadata = {
  readonly oldPath?: string
  readonly newPath?: string
  readonly oldObjectId?: string
  readonly newObjectId?: string
  readonly oldMode?: string
  readonly newMode?: string
  readonly changeType?: DiffFileChangeType
}

type MutableGitFileMetadata = {
  -readonly [Key in keyof GitFileMetadata]?: GitFileMetadata[Key]
}

export function createTextDiff(options: CreateTextDiffOptions): DiffFile {
  const oldFile = options.oldFile ?? null
  const newFile = options.newFile ?? null
  const oldText = oldFile?.text ?? ''
  const newText = newFile?.text ?? ''
  const oldPath = oldFile?.path ?? newFile?.path ?? ''
  const newPath = newFile?.path ?? oldFile?.path ?? ''
  const patch = structuredPatch(oldPath, newPath, oldText, newText, undefined, undefined, {
    context: normalizeContextLines(options.contextLines),
    ignoreWhitespace: options.ignoreWhitespace,
  }) as ParsedPatchFile

  return {
    path: newPath || oldPath,
    oldPath,
    newPath,
    changeType: changeTypeForTextFiles(oldFile, newFile, oldPath, newPath),
    oldObjectId: oldFile?.objectId,
    newObjectId: newFile?.objectId,
    oldMode: oldFile?.mode,
    newMode: newFile?.mode,
    oldLines: splitTextLines(oldText),
    newLines: splitTextLines(newText),
    hunks: convertPatchHunks(patch.hunks ?? []),
    isPartial: false,
    languageId: newFile?.languageId ?? oldFile?.languageId ?? languageIdForPath(newPath || oldPath),
  }
}

export function parseGitPatch(
  patchText: string,
  options: ParseGitPatchOptions = {},
): readonly DiffFile[] {
  const parsed = parsePatchTolerant(patchText)
  const metadata = gitMetadataByPath(patchText)

  return parsed
    .filter(isParsedPatchFileUsable)
    .map((file, index) =>
      convertParsedPatchFile(file, metadata, cacheKeyForPatch(options.cacheKey, index)),
    )
}

function parsePatchTolerant(patchText: string): readonly ParsedPatchFile[] {
  try {
    return parsePatch(patchText) as readonly ParsedPatchFile[]
  } catch {
    return parsePatch(removeRepeatedHunkHeaders(patchText)) as readonly ParsedPatchFile[]
  }
}

function removeRepeatedHunkHeaders(patchText: string): string {
  const lines = patchText.split('\n')
  const cleaned: string[] = []

  for (const line of lines) {
    const previous = cleaned.at(-1)
    if (previous && isRawHunkHeader(previous) && isRawHunkHeader(line)) continue
    cleaned.push(line)
  }

  return cleaned.join('\n')
}

function isParsedPatchFileUsable(file: ParsedPatchFile): boolean {
  const oldPath = stripDiffPathPrefix(file.oldFileName)
  const newPath = stripDiffPathPrefix(file.newFileName)
  return normalizedFilePath(oldPath, newPath).length > 0
}

function convertParsedPatchFile(
  file: ParsedPatchFile,
  metadata: ReadonlyMap<string, GitFileMetadata>,
  cacheKey: string | undefined,
): DiffFile {
  const oldPath = stripDiffPathPrefix(file.oldFileName)
  const newPath = stripDiffPathPrefix(file.newFileName)
  const path = normalizedFilePath(oldPath, newPath)
  const git = metadata.get(path) ?? metadata.get(oldPath) ?? metadata.get(newPath)
  const hunks = convertPatchHunks(file.hunks ?? [])

  return {
    path,
    oldPath: normalizedOptionalPath(git?.oldPath ?? oldPath),
    newPath: normalizedOptionalPath(git?.newPath ?? newPath) ?? path,
    changeType: git?.changeType ?? changeTypeForPatchPaths(oldPath, newPath),
    oldObjectId: git?.oldObjectId,
    newObjectId: git?.newObjectId,
    oldMode: git?.oldMode,
    newMode: git?.newMode,
    oldLines: collectPatchLines(hunks, 'old'),
    newLines: collectPatchLines(hunks, 'new'),
    hunks,
    isPartial: true,
    languageId: languageIdForPath(path),
    cacheKey,
  }
}

function convertPatchHunks(hunks: readonly ParsedPatchHunk[]): readonly DiffHunk[] {
  return hunks.map((hunk) => convertPatchHunk(hunk))
}

function convertPatchHunk(hunk: ParsedPatchHunk): DiffHunk {
  return {
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    header: hunkHeader(hunk),
    lines: annotateInlineChanges(convertPatchLines(hunk)),
  }
}

function convertPatchLines(hunk: ParsedPatchHunk): readonly DiffHunkLine[] {
  const lines: DiffHunkLine[] = []
  let oldLineNumber = hunk.oldStart
  let newLineNumber = hunk.newStart

  for (const rawLine of hunk.lines) {
    const result = convertPatchLine(rawLine, oldLineNumber, newLineNumber)
    if (!result) continue

    lines.push(result.line)
    oldLineNumber += result.oldDelta
    newLineNumber += result.newDelta
  }

  return lines
}

function convertPatchLine(
  rawLine: string,
  oldLineNumber: number,
  newLineNumber: number,
): { readonly line: DiffHunkLine; readonly oldDelta: number; readonly newDelta: number } | null {
  if (rawLine.startsWith('\\')) return null
  if (isRawHunkHeader(rawLine)) return null

  const marker = rawLine[0] ?? ' '
  const text = rawLine.slice(1)
  if (isRawHunkHeader(text)) return null

  if (marker === '-') {
    return {
      line: { type: 'deletion', text, oldLineNumber },
      oldDelta: 1,
      newDelta: 0,
    }
  }
  if (marker === '+') {
    return {
      line: { type: 'addition', text, newLineNumber },
      oldDelta: 0,
      newDelta: 1,
    }
  }

  return {
    line: { type: 'context', text, oldLineNumber, newLineNumber },
    oldDelta: 1,
    newDelta: 1,
  }
}

function isRawHunkHeader(text: string): boolean {
  return /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(text.trim())
}

function hunkHeader(hunk: ParsedPatchHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

function collectPatchLines(hunks: readonly DiffHunk[], side: 'old' | 'new'): readonly string[] {
  const lines: string[] = []
  for (const hunk of hunks) appendPatchLines(lines, hunk, side)
  return lines
}

function appendPatchLines(lines: string[], hunk: DiffHunk, side: 'old' | 'new'): void {
  for (const line of hunk.lines) {
    if (side === 'old' && line.type === 'addition') continue
    if (side === 'new' && line.type === 'deletion') continue
    lines.push(line.text)
  }
}

function changeTypeForTextFiles(
  oldFile: DiffTextFile | null,
  newFile: DiffTextFile | null,
  oldPath: string,
  newPath: string,
): DiffFileChangeType {
  if (!oldFile && newFile) return 'add'
  if (oldFile && !newFile) return 'delete'
  if (oldPath !== newPath) return 'rename-change'
  return 'change'
}

function changeTypeForPatchPaths(oldPath: string, newPath: string): DiffFileChangeType {
  if (oldPath === '/dev/null') return 'add'
  if (newPath === '/dev/null') return 'delete'
  if (oldPath && newPath && oldPath !== newPath) return 'rename-change'
  return 'change'
}

function normalizedFilePath(oldPath: string, newPath: string): string {
  if (newPath && newPath !== '/dev/null') return newPath
  if (oldPath && oldPath !== '/dev/null') return oldPath
  return newPath || oldPath
}

function normalizedOptionalPath(path: string | undefined): string | undefined {
  if (!path || path === '/dev/null') return undefined
  return path
}

function cacheKeyForPatch(prefix: string | undefined, index: number): string | undefined {
  if (!prefix) return undefined
  return `${prefix}-${index}`
}

function gitMetadataByPath(patchText: string): ReadonlyMap<string, GitFileMetadata> {
  const metadata = new Map<string, GitFileMetadata>()
  for (const section of gitFileSections(patchText)) addGitMetadata(metadata, section)
  return metadata
}

function gitFileSections(patchText: string): readonly string[] {
  return patchText
    .split(/(?=^diff --git )/m)
    .map((section) => section.trim())
    .filter((section) => section.startsWith('diff --git '))
}

function addGitMetadata(metadata: Map<string, GitFileMetadata>, section: string): void {
  const parsed = parseGitSection(section)
  const path = normalizedFilePath(parsed.oldPath ?? '', parsed.newPath ?? '')
  if (!path) return

  metadata.set(path, parsed)
  if (parsed.oldPath) metadata.set(parsed.oldPath, parsed)
  if (parsed.newPath) metadata.set(parsed.newPath, parsed)
}

function parseGitSection(section: string): GitFileMetadata {
  const lines = section.split('\n')
  const paths = parseDiffGitPaths(lines[0] ?? '')
  const partial: MutableGitFileMetadata = {
    oldPath: paths.oldPath,
    newPath: paths.newPath,
  }

  for (const line of lines) applyGitMetadataLine(partial, line)
  partial.changeType = gitChangeType(partial, section)
  return partial as GitFileMetadata
}

function parseDiffGitPaths(line: string): { readonly oldPath?: string; readonly newPath?: string } {
  const match = line.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/)
  if (!match) return {}
  return {
    oldPath: stripDiffPathPrefix(`a/${match[1]}`),
    newPath: stripDiffPathPrefix(`b/${match[2]}`),
  }
}

function applyGitMetadataLine(partial: MutableGitFileMetadata, line: string): void {
  if (line.startsWith('index ')) applyIndexMetadata(partial, line)
  if (line.startsWith('old mode ')) partial.oldMode = line.slice('old mode '.length).trim()
  if (line.startsWith('new mode ')) partial.newMode = line.slice('new mode '.length).trim()
  if (line.startsWith('new file mode '))
    partial.newMode = line.slice('new file mode '.length).trim()
  if (line.startsWith('deleted file mode ')) {
    partial.oldMode = line.slice('deleted file mode '.length).trim()
  }
  if (line.startsWith('rename from ')) partial.oldPath = line.slice('rename from '.length).trim()
  if (line.startsWith('rename to ')) partial.newPath = line.slice('rename to '.length).trim()
}

function applyIndexMetadata(partial: MutableGitFileMetadata, line: string): void {
  const match = line.match(/^index\s+([0-9a-f]+)\.\.([0-9a-f]+)(?:\s+(\d+))?/i)
  if (!match) return

  partial.oldObjectId = match[1]
  partial.newObjectId = match[2]
  if (match[3]) {
    partial.oldMode = partial.oldMode ?? match[3]
    partial.newMode = partial.newMode ?? match[3]
  }
}

function gitChangeType(partial: MutableGitFileMetadata, section: string): DiffFileChangeType {
  if (section.includes('\nnew file mode ')) return 'add'
  if (section.includes('\ndeleted file mode ')) return 'delete'
  if (partial.oldPath && partial.newPath && partial.oldPath !== partial.newPath) {
    return section.includes('\n@@ ') ? 'rename-change' : 'rename'
  }
  return 'change'
}
