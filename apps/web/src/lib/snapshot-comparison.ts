import type { SettingsViewTarget } from '@workspace/contracts'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import { createTextDiff } from '@singapore-editor/diff'
import type { FileResult } from '@/lib/file-system-types'
import { languageIdForFilePath } from '@/lib/file-language'
import { sameGitInputRevision } from '@/lib/documents/utils/comparisons'
import type {
  DocumentTextSnapshot,
  EditorTextBuffer,
  HistoryComparisonSide,
  TextSnapshot,
} from '@singapore-editor/core/document'
import type { PreparedWorkspaceTextSegment } from '@singapore-editor/lsp-plugin/workspace-edit'
import type { DiffFile } from '@singapore-editor/diff'
import type {
  DocumentKey,
  FilesystemPath,
  GitComparison,
  GitInputRevision,
} from '@/lib/documents/utils/types'
import type { GitDiffHunk } from '@workspace/contracts'
import type {
  ImmutableGitSide,
  SnapshotComparison,
  SnapshotComparisonScope,
} from '@/lib/documents/utils/snapshot-comparison'

export type SnapshotComparisonFile =
  | {
      readonly kind: 'full'
      readonly old: ImmutableGitSide
      readonly new: ImmutableGitSide
      readonly display: readonly DiffFile[]
    }
  | { readonly kind: 'partial'; readonly display: readonly DiffFile[] }
  | { readonly kind: 'no-text'; readonly reason: 'binary' | 'size' | 'unavailable' }
export type SnapshotGitComparisonInput = {
  readonly kind: 'snapshot'
  readonly scope: SnapshotComparisonScope
  readonly subject: DocumentKey
  readonly comparison: SnapshotComparison
  readonly revision: GitInputRevision
  readonly files: readonly SnapshotComparisonFile[]
  readonly display: readonly DiffFile[]
}
export type CheckpointComparison = Exclude<GitComparison, { kind: 'snapshot' }>
export type CheckpointComparisonFile = SnapshotComparisonFile & {
  readonly path: FilesystemPath
  readonly revision: GitInputRevision
  readonly patch: string
  readonly hunks: readonly GitDiffHunk[]
}
export type CheckpointComparisonInput = {
  readonly kind: 'checkpoint'
  readonly scope: SnapshotComparisonScope
  readonly subject: DocumentKey
  readonly comparison: CheckpointComparison
  readonly files: readonly CheckpointComparisonFile[]
  readonly display: readonly DiffFile[]
}
export type HistoryComparisonInput = {
  readonly kind: 'history'
  readonly scope: SnapshotComparisonScope
  readonly subject: DocumentKey
  readonly path: FilesystemPath
  readonly buffer: EditorTextBuffer
  readonly old: HistoryComparisonSide
  readonly new: HistoryComparisonSide
  readonly coverage: 'full' | 'too-large'
}
export type OperationComparisonInput = {
  readonly kind: 'operation'
  readonly subject: string
  readonly scope: SnapshotComparisonScope
  readonly root: {
    readonly generation: number
    readonly path: FilesystemPath
    readonly uriPath: FilesystemPath
    readonly workspacePath: FilesystemPath
  }
  readonly operationId: string
  readonly operationIndex: number
  readonly path: FilesystemPath
  readonly segment: PreparedWorkspaceTextSegment
  readonly old: DocumentTextSnapshot
  readonly new: DocumentTextSnapshot
  readonly display: DiffFile
}
export type SnapshotComparisonInput =
  | SnapshotGitComparisonInput
  | CheckpointComparisonInput
  | HistoryComparisonInput
  | OperationComparisonInput
  | FilesystemComparisonInput
  | SettingsComparisonInput
export type SnapshotComparisonRead =
  | { readonly kind: 'ready'; readonly input: SnapshotComparisonInput }
  | { readonly kind: 'released'; readonly reason: 'interest-ended' | 'owner-disposed' }
export type SnapshotComparisonRefresh = { readonly lease: SnapshotComparisonLease }
export type SnapshotComparisonLease = {
  read(): SnapshotComparisonRead
  requestRefresh(): SnapshotComparisonRefresh
  refresh(input: SnapshotComparisonInput, request: SnapshotComparisonRefresh): boolean
  release(): void
}
export type SnapshotComparisonRequest = {
  readonly input: SnapshotComparisonInput
  readonly signal: AbortSignal
}

export function sameCheckpointCapture(
  left: CheckpointComparisonInput,
  right: CheckpointComparisonInput,
): boolean {
  return (
    left.subject === right.subject &&
    left.files.length === right.files.length &&
    left.files.every((file, index) => {
      const other = right.files[index]
      return (
        other !== undefined &&
        file.path === other.path &&
        sameGitInputRevision(file.revision, other.revision) &&
        file.patch === other.patch &&
        file.hunks.length === other.hunks.length &&
        file.hunks.every((hunk, hunkIndex) => hunk.id === other.hunks[hunkIndex]?.id)
      )
    })
  )
}

export function promoteCheckpointCapture(
  current: CheckpointComparisonInput,
  candidate: CheckpointComparisonInput,
): CheckpointComparisonInput | null {
  const files = current.files.map((file, index) => {
    const next = candidate.files[index]
    return file.kind === 'partial' && next?.kind === 'full' ? next : file
  })
  if (files.every((file, index) => file === current.files[index])) return null
  return {
    ...current,
    files,
    display: files.flatMap((file) => (file.kind === 'no-text' ? [] : file.display)),
  }
}

export function sameHistoryCapture(
  left: HistoryComparisonInput,
  right: HistoryComparisonInput,
): boolean {
  return (
    left.buffer === right.buffer &&
    sameHistorySide(left.old, right.old) &&
    sameHistorySide(left.new, right.new)
  )
}

function sameHistorySide(left: HistoryComparisonSide, right: HistoryComparisonSide): boolean {
  return (
    left.id === right.id && left.revision === right.revision && left.snapshot === right.snapshot
  )
}

export function operationComparisonSubject(
  input: Omit<OperationComparisonInput, 'subject'>,
): string {
  return JSON.stringify([
    'operation',
    input.scope.environmentId,
    input.scope.rootPath,
    input.root.generation,
    input.root.uriPath,
    input.root.workspacePath,
    input.operationId,
    input.operationIndex,
    input.segment.segmentIndex,
    input.segment.uri,
  ])
}

export function sameOperationCapture(
  left: OperationComparisonInput,
  right: OperationComparisonInput,
): boolean {
  return (
    operationComparisonSubject(left) === operationComparisonSubject(right) &&
    left.root.path === right.root.path &&
    left.path === right.path &&
    left.segment === right.segment &&
    left.old.snapshot === right.old.snapshot &&
    left.new.snapshot === right.new.snapshot &&
    left.display === right.display
  )
}

export type FilesystemLocalCapture =
  | {
      readonly kind: 'text'
      readonly path: FilesystemPath
      readonly buffer: EditorTextBuffer
      readonly revision: number
      readonly snapshot: DocumentTextSnapshot
    }
  | { readonly kind: 'missing'; readonly path: FilesystemPath }
export type FilesystemIncomingCapture =
  | { readonly kind: 'text'; readonly file: FileResult; readonly reader: TextSnapshot }
  | { readonly kind: 'binary' | 'unsupported'; readonly file: FileResult }
  | { readonly kind: 'deleted'; readonly path: FilesystemPath }
export type FilesystemComparisonCapture = {
  readonly scope: SnapshotComparisonScope
  readonly conflictId: string
  readonly eventType: 'changed' | 'deleted' | 'renamed'
  readonly local: FilesystemLocalCapture
  readonly incoming: FilesystemIncomingCapture
}
export type FilesystemComparisonInput = {
  readonly kind: 'filesystem'
  readonly scope: SnapshotComparisonScope
  readonly capture: FilesystemComparisonCapture
  readonly display:
    | { readonly kind: 'text'; readonly file: DiffFile }
    | { readonly kind: 'no-text'; readonly reason: 'binary' | 'unsupported' | 'local-missing' }
}
export function captureFilesystemLocal(
  path: FilesystemPath,
  buffer: EditorTextBuffer | null,
): FilesystemLocalCapture {
  if (!buffer) return { kind: 'missing', path }
  return {
    kind: 'text',
    path,
    buffer,
    revision: buffer.getRevision(),
    snapshot: buffer.getTextSnapshot(),
  }
}
export function filesystemIncomingText(file: FileResult): FilesystemIncomingCapture {
  return { kind: 'text', file, reader: createStringTextSnapshot(file.content) }
}
export function filesystemComparisonInput(
  capture: FilesystemComparisonCapture,
): FilesystemComparisonInput {
  const { local, incoming } = capture
  if (incoming.kind === 'binary' || incoming.kind === 'unsupported')
    return {
      kind: 'filesystem',
      scope: capture.scope,
      capture,
      display: { kind: 'no-text', reason: incoming.kind },
    }
  if (local.kind === 'missing')
    return {
      kind: 'filesystem',
      scope: capture.scope,
      capture,
      display: { kind: 'no-text', reason: 'local-missing' },
    }
  const newPath = incoming.kind === 'deleted' ? incoming.path : incoming.file.path
  const file = createTextDiff({
    oldFile: {
      path: local.path,
      languageId: languageIdForFilePath(local.path),
      text: local.snapshot.materializeFullText(),
    },
    newFile: {
      path: newPath,
      languageId: languageIdForFilePath(newPath),
      text: incoming.kind === 'text' ? incoming.reader.materializeFullText() : '',
    },
  })
  return { kind: 'filesystem', scope: capture.scope, capture, display: { kind: 'text', file } }
}
export function filesystemComparisonSubject(capture: FilesystemComparisonCapture): string {
  return JSON.stringify([
    'filesystem',
    capture.scope.environmentId,
    capture.scope.rootPath,
    capture.conflictId,
  ])
}
export function sameFilesystemCapture(
  left: FilesystemComparisonInput,
  right: FilesystemComparisonInput,
): boolean {
  return left.capture === right.capture && left.display === right.display
}

export type SettingsComparisonRequest = {
  readonly scope: SnapshotComparisonScope
  readonly key: DocumentKey
  readonly signal: AbortSignal
}
export type SettingsComparisonInput = {
  readonly kind: 'settings'
  readonly scope: SnapshotComparisonScope
  readonly key: DocumentKey
  readonly target: SettingsViewTarget
  readonly local: {
    readonly buffer: EditorTextBuffer
    readonly revision: number
    readonly snapshot: DocumentTextSnapshot
  }
  readonly confirmed:
    | { readonly kind: 'confirmed'; readonly revision: string; readonly reader: TextSnapshot }
    | { readonly kind: 'pending' }
}
export function settingsComparisonSubject(input: SettingsComparisonInput): string {
  return JSON.stringify(['settings', input.scope.environmentId, input.scope.rootPath, input.key])
}
