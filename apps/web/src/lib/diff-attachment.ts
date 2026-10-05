import type { EditorTextBuffer } from '@singapore-editor/core/document'
import { createTextDiff, splitTextLines, type DiffFile } from '@singapore-editor/diff'
import type { SavedComparisonRead } from '@/lib/saved-comparison'
import type {
  SnapshotComparisonRead,
  SnapshotComparisonFile,
  HistoryComparisonInput,
  OperationComparisonInput,
  FilesystemComparisonInput,
  SettingsComparisonInput,
} from '@/lib/snapshot-comparison'
import {
  operationComparisonSubject,
  filesystemComparisonSubject,
  settingsComparisonSubject,
} from '@/lib/snapshot-comparison'
import { materializeFileSnapshotText } from '@/lib/file-snapshot'
import { languageIdForFilePath } from '@/lib/file-language'

type ReadyComparison = Extract<SnapshotComparisonRead, { kind: 'ready' }>
type ReadySnapshot = ReadyComparison & {
  readonly input: Extract<ReadyComparison['input'], { kind: 'snapshot' | 'checkpoint' }>
}
type ReadyFilesystem = ReadyComparison & { readonly input: FilesystemComparisonInput }
type ReadyOperation = ReadyComparison & { readonly input: OperationComparisonInput }
type ReadyHistory = ReadyComparison & { readonly input: HistoryComparisonInput }
type TextChild = Exclude<SnapshotComparisonFile, { kind: 'no-text' }>
type ReadySaved = Extract<SavedComparisonRead, { kind: 'ready' }>

export type DiffAttachment =
  | {
      readonly kind: 'settings'
      readonly read: ReadyComparison & { readonly input: SettingsComparisonInput }
      readonly file: DiffFile
    }
  | {
      readonly kind: 'filesystem'
      readonly read: ReadyFilesystem
      readonly file: DiffFile
      readonly meaning: 'seed' | 'latest'
    }
  | { readonly kind: 'operation'; readonly read: ReadyOperation; readonly file: DiffFile }
  | {
      readonly kind: 'snapshot'
      readonly read: ReadySnapshot
      readonly child: TextChild
      readonly file: DiffFile
    }
  | { readonly kind: 'saved'; readonly read: ReadySaved; readonly file: DiffFile }
  | {
      readonly kind: 'history'
      readonly read: ReadyHistory
      readonly meaning: 'focused' | 'selected'
      readonly file: DiffFile
    }
  | {
      readonly kind: 'projection-control'
      readonly subject: string
      readonly revision: string
      readonly file: DiffFile
    }

export type DiffAttachmentSubject = {
  readonly key: string
  readonly buffer: EditorTextBuffer | null
}

export function snapshotDiffAttachment(
  read: ReadyComparison | null,
  file: DiffFile | null,
): DiffAttachment | null {
  if (!read || !file || !isSnapshotRead(read)) return null
  const child = read.input.files.find(
    (entry) => entry.kind !== 'no-text' && entry.display.includes(file),
  )
  if (!child || child.kind === 'no-text') return null
  return { kind: 'snapshot', read, child, file }
}

export function savedDiffAttachment(read: ReadySaved): DiffAttachment {
  const path = read.saved.snapshot.path
  const languageId = languageIdForFilePath(path)
  const file = createTextDiff({
    newFile: { languageId, path, text: read.live.snapshot.materializeFullText() },
    oldFile: { languageId, path, text: materializeFileSnapshotText(read.saved.snapshot) },
  })
  return { kind: 'saved', read, file }
}

export function historyDiffAttachment(
  read: SnapshotComparisonRead | null,
  file: DiffFile | null,
  meaning: 'focused' | 'selected',
): DiffAttachment | null {
  if (
    !read ||
    read.kind !== 'ready' ||
    !isHistoryRead(read) ||
    read.input.coverage !== 'full' ||
    !file
  )
    return null
  return { kind: 'history', read, file, meaning }
}

export function operationDiffAttachment(
  read: SnapshotComparisonRead | null,
  file: DiffFile | null,
): DiffAttachment | null {
  if (!read || read.kind !== 'ready' || !isOperationRead(read) || file !== read.input.display)
    return null
  return { kind: 'operation', read, file }
}

export function filesystemDiffAttachment(
  read: SnapshotComparisonRead | null,
  meaning: 'seed' | 'latest',
): DiffAttachment | null {
  if (
    !read ||
    read.kind !== 'ready' ||
    !isFilesystemRead(read) ||
    read.input.display.kind !== 'text'
  )
    return null
  return { kind: 'filesystem', read, file: read.input.display.file, meaning }
}
function isFilesystemRead(read: ReadyComparison): read is ReadyFilesystem {
  return read.input.kind === 'filesystem'
}

function isOperationRead(read: ReadyComparison): read is ReadyOperation {
  return read.input.kind === 'operation'
}

function isSnapshotRead(read: ReadyComparison): read is ReadySnapshot {
  return read.input.kind === 'snapshot' || read.input.kind === 'checkpoint'
}

function isHistoryRead(read: ReadyComparison): read is ReadyHistory {
  return read.input.kind === 'history'
}

export function diffAttachmentSubject(attachment: DiffAttachment): DiffAttachmentSubject {
  switch (attachment.kind) {
    case 'projection-control':
      return { key: attachment.subject, buffer: null }
    case 'saved': {
      const { read } = attachment
      return {
        key: JSON.stringify([
          'saved',
          read.scope.environmentId,
          read.scope.rootPath,
          read.live.key,
        ]),
        buffer: read.live.buffer,
      }
    }
    case 'settings':
      return {
        key: settingsComparisonSubject(attachment.read.input),
        buffer: attachment.read.input.local.buffer,
      }
    case 'filesystem': {
      const capture = attachment.read.input.capture
      return {
        key: JSON.stringify([filesystemComparisonSubject(capture), attachment.meaning]),
        buffer: capture.local.kind === 'text' ? capture.local.buffer : null,
      }
    }
    case 'operation':
      return { key: operationComparisonSubject(attachment.read.input), buffer: null }
    case 'history': {
      const input = attachment.read.input
      const sides =
        attachment.meaning === 'focused' ? ['current', input.new.id] : [input.old.id, input.new.id]
      return {
        key: JSON.stringify([
          'history',
          input.scope.environmentId,
          input.scope.rootPath,
          input.subject,
          attachment.meaning,
          ...sides,
        ]),
        buffer: input.buffer,
      }
    }
    case 'snapshot': {
      const input = attachment.read.input
      return {
        key: JSON.stringify([
          'snapshot',
          input.scope.environmentId,
          input.scope.rootPath,
          input.subject,
          attachment.file.oldPath,
          attachment.file.newPath,
        ]),
        buffer: null,
      }
    }
  }
  const exhaustive: never = attachment
  return exhaustive
}

export function sameDiffAttachmentSubject(
  left: DiffAttachmentSubject,
  right: DiffAttachmentSubject,
): boolean {
  return left.key === right.key && left.buffer === right.buffer
}

export function diffAttachmentRevision(attachment: DiffAttachment): string {
  switch (attachment.kind) {
    case 'projection-control':
      return attachment.revision
    case 'saved':
      return JSON.stringify([attachment.read.live.revision, attachment.read.saved.snapshot.version])
    case 'settings':
      return JSON.stringify([
        attachment.read.input.local.revision,
        attachment.read.input.confirmed.kind === 'confirmed'
          ? attachment.read.input.confirmed.revision
          : null,
      ])
    case 'filesystem': {
      const { local, incoming, eventType } = attachment.read.input.capture
      return JSON.stringify([
        eventType,
        local.kind === 'text' ? local.revision : local.kind,
        incoming.kind === 'deleted' ? incoming.kind : incoming.file.version,
      ])
    }
    case 'operation': {
      const segment = attachment.read.input.segment
      return JSON.stringify([
        segment.segmentIndex,
        segment.sequenceSegmentIndex,
        segment.logicalRevisionCount,
        segment.simulatedVersionBefore,
        segment.simulatedVersionAfter,
      ])
    }
    case 'history': {
      const input = attachment.read.input
      return JSON.stringify([input.old.id, input.old.revision, input.new.id, input.new.revision])
    }
    case 'snapshot': {
      const input = attachment.read.input
      if (input.kind === 'snapshot') return JSON.stringify(input.revision)
      const child = input.files.find(
        (entry) => entry.kind !== 'no-text' && entry.display.includes(attachment.file),
      )
      return JSON.stringify([child?.revision, child?.hunks.map((hunk) => hunk.id)])
    }
  }
  const exhaustive: never = attachment
  return exhaustive
}

export function diffAttachmentLines(
  attachment: DiffAttachment,
): Readonly<Record<'old' | 'new', readonly string[] | null>> {
  switch (attachment.kind) {
    case 'settings':
      return {
        old:
          attachment.read.input.confirmed.kind === 'confirmed'
            ? splitTextLines(attachment.read.input.confirmed.reader.materializeFullText())
            : null,
        new: splitTextLines(attachment.read.input.local.snapshot.materializeFullText()),
      }
    case 'filesystem': {
      const { local, incoming } = attachment.read.input.capture
      return {
        old: local.kind === 'text' ? splitTextLines(local.snapshot.materializeFullText()) : null,
        new: incoming.kind === 'text' ? splitTextLines(incoming.reader.materializeFullText()) : [],
      }
    }
    case 'operation':
      return {
        old: splitTextLines(attachment.read.input.old.materializeFullText()),
        new: splitTextLines(attachment.read.input.new.materializeFullText()),
      }
    case 'snapshot': {
      if (attachment.file.isPartial) return { old: null, new: null }
      if (attachment.read.input.kind !== 'checkpoint' || attachment.child.kind !== 'full')
        return { old: attachment.file.oldLines, new: attachment.file.newLines }
      return {
        old: attachment.child.old.kind === 'blob' ? splitTextLines(attachment.child.old.text) : [],
        new: attachment.child.new.kind === 'blob' ? splitTextLines(attachment.child.new.text) : [],
      }
    }
    case 'saved':
    case 'history':
    case 'projection-control':
      return attachment.file.isPartial
        ? { old: null, new: null }
        : { old: attachment.file.oldLines, new: attachment.file.newLines }
  }
  const exhaustive: never = attachment
  return exhaustive
}

export function diffAttachmentReferences(attachment: DiffAttachment): readonly object[] {
  switch (attachment.kind) {
    case 'projection-control':
      return [attachment.file]
    case 'snapshot':
      return [attachment.child]
    case 'saved':
      return [attachment.read.live.snapshot, attachment.read.saved.snapshot]
    case 'history':
      return [attachment.read.input.old.snapshot, attachment.read.input.new.snapshot]
    case 'settings':
      return [
        attachment.read.input.local.buffer,
        attachment.read.input.local.snapshot.snapshot,
        ...(attachment.read.input.confirmed.kind === 'confirmed'
          ? [attachment.read.input.confirmed.reader]
          : []),
      ]
    case 'filesystem': {
      const capture = attachment.read.input.capture
      const references: object[] = [capture, attachment.file]
      if (capture.local.kind === 'text')
        references.push(capture.local.buffer, capture.local.snapshot.snapshot)
      if (capture.incoming.kind !== 'deleted') references.push(capture.incoming.file)
      if (capture.incoming.kind === 'text') references.push(capture.incoming.reader)
      return references
    }
    case 'operation': {
      const input = attachment.read.input
      return [input.segment, input.old.snapshot, input.new.snapshot, input.display]
    }
  }
  const exhaustive: never = attachment
  return exhaustive
}

export type SettingsComparisonPresentation = {
  readonly read: ReadyComparison & { readonly input: SettingsComparisonInput }
  readonly attachment: Extract<DiffAttachment, { kind: 'settings' }> | null
}
export function settingsDiffAttachment(
  read: SnapshotComparisonRead | null,
): Extract<DiffAttachment, { kind: 'settings' }> | null {
  if (
    !read ||
    read.kind !== 'ready' ||
    !isSettingsRead(read) ||
    read.input.confirmed.kind !== 'confirmed'
  )
    return null
  const input = read.input
  const file = createTextDiff({
    oldFile: {
      path: `settings.json (confirmed ${input.target})`,
      languageId: 'json',
      text: read.input.confirmed.reader.materializeFullText(),
    },
    newFile: {
      path: `settings.json (current ${input.target})`,
      languageId: 'json',
      text: input.local.snapshot.materializeFullText(),
    },
  })
  return { kind: 'settings', read, file }
}
export function isSettingsRead(
  read: ReadyComparison,
): read is ReadyComparison & { readonly input: SettingsComparisonInput } {
  return read.input.kind === 'settings'
}
