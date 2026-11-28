import { isRecord } from '@workspace/utils/objects'
import type { EditorPreparedTagValue, EditorScrollPosition } from '@singapore-editor/core/editor'

import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { FileSnapshot } from '@/lib/file-snapshot'
import type {
  FileOpenIntentEnvironmentIdentity,
  FileOpenIntentPreparationStage,
  FileOpenIntentStructuralRange,
} from './service'

export type FileSnapshotIdentity = Pick<FileSnapshot, 'path' | 'version'>

export function sameStage(
  left: FileOpenIntentPreparationStage | undefined,
  right: FileOpenIntentPreparationStage | undefined,
): boolean {
  if (!left || !right) return left === right
  if (left.family !== right.family) return false
  if (left.provider !== right.provider) return false
  if (!sameStageRange(left.range, right.range)) return false
  return sameTag(left.configurationTag, right.configurationTag)
}

function sameStageRange(
  left: FileOpenIntentPreparationStage['range'],
  right: FileOpenIntentPreparationStage['range'],
): boolean {
  if (left === 'full' || right === 'full') return left === right
  if (!left || !right) return left === right
  return sameStructuralRange(left, right)
}

function sameStructuralRange(
  left: FileOpenIntentStructuralRange,
  right: FileOpenIntentStructuralRange,
): boolean {
  return left.startIndex === right.startIndex && left.endIndex === right.endIndex
}

export function sameTag(
  left: readonly EditorPreparedTagValue[],
  right: readonly EditorPreparedTagValue[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => Object.is(value, right[index]))
}

export function sameEnvironment(
  left: FileOpenIntentEnvironmentIdentity,
  right: FileOpenIntentEnvironmentIdentity,
): boolean {
  if (left.highlighterProvider !== right.highlighterProvider) return false
  if (left.structuralProvider !== right.structuralProvider) return false
  return sameTag(left.configurationTag, right.configurationTag)
}

export function defaultStructuralRange(
  snapshotLength: number,
  scrollPosition: EditorScrollPosition | null,
): FileOpenIntentStructuralRange {
  const estimatedRow = Math.floor((scrollPosition?.top ?? 0) / 20)
  const estimatedOffset = estimatedRow * 96
  const startIndex = Math.min(snapshotLength, Math.max(0, estimatedOffset - 16 * 1024))
  return {
    endIndex: Math.min(snapshotLength, startIndex + 64 * 1024),
    startIndex,
  }
}

export function cleanFileIdentityMatches(
  source: { readonly path: FilesystemPath; readonly fileVersion: string },
  file: FileSnapshotIdentity,
): boolean {
  return source.path === file.path && source.fileVersion === file.version
}

export function fileResultIdentity(value: unknown): FileSnapshotIdentity | null {
  if (!isRecord(value)) return null
  if (typeof value.path !== 'string') return null
  if (typeof value.version !== 'string') return null
  return { path: filesystemPath(value.path), version: value.version }
}
