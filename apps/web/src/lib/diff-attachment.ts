import type { EditorTextBuffer } from '@singapore-editor/core/document'
import { createTextDiff, splitTextLines, type DiffFile } from '@singapore-editor/diff'
import type { SavedComparisonRead } from '@/lib/saved-comparison'
import type {
  SnapshotComparisonRead,
  SnapshotComparisonFile,
  HistoryComparisonInput,
} from '@/lib/snapshot-comparison'
import { materializeFileSnapshotText } from '@/lib/file-snapshot'
import { languageIdForFilePath } from '@/lib/file-language'

type ReadyComparison = Extract<SnapshotComparisonRead, { kind: 'ready' }>
type ReadySnapshot = ReadyComparison & {
  readonly input: Exclude<ReadyComparison['input'], HistoryComparisonInput>
}
type ReadyHistory = ReadyComparison & { readonly input: HistoryComparisonInput }
type TextChild = Exclude<SnapshotComparisonFile, { kind: 'no-text' }>
type ReadySaved = Extract<SavedComparisonRead, { kind: 'ready' }>

export type DiffAttachment =
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

function isSnapshotRead(read: ReadyComparison): read is ReadySnapshot {
  return read.input.kind !== 'history'
}

function isHistoryRead(read: ReadyComparison): read is ReadyHistory {
  return read.input.kind === 'history'
}

export function diffAttachmentSubject(attachment: DiffAttachment): DiffAttachmentSubject {
  if (attachment.kind === 'projection-control') return { key: attachment.subject, buffer: null }
  if (attachment.kind === 'saved') {
    const { read } = attachment
    return {
      key: JSON.stringify(['saved', read.scope.environmentId, read.scope.rootPath, read.live.key]),
      buffer: read.live.buffer,
    }
  }
  const input = attachment.read.input
  const scope = [input.scope.environmentId, input.scope.rootPath, input.subject]
  if (attachment.kind === 'history' && input.kind === 'history') {
    const sides =
      attachment.meaning === 'focused' ? ['current', input.new.id] : [input.old.id, input.new.id]
    return {
      key: JSON.stringify(['history', ...scope, attachment.meaning, ...sides]),
      buffer: input.buffer,
    }
  }
  return {
    key: JSON.stringify(['snapshot', ...scope, attachment.file.oldPath, attachment.file.newPath]),
    buffer: null,
  }
}

export function sameDiffAttachmentSubject(
  left: DiffAttachmentSubject,
  right: DiffAttachmentSubject,
): boolean {
  return left.key === right.key && left.buffer === right.buffer
}

export function diffAttachmentRevision(attachment: DiffAttachment): string {
  if (attachment.kind === 'projection-control') return attachment.revision
  if (attachment.kind === 'saved')
    return JSON.stringify([attachment.read.live.revision, attachment.read.saved.snapshot.version])
  const input = attachment.read.input
  if (input.kind === 'history')
    return JSON.stringify([input.old.id, input.old.revision, input.new.id, input.new.revision])
  if (input.kind === 'snapshot') return JSON.stringify(input.revision)
  const child = input.files.find(
    (entry) => entry.kind !== 'no-text' && entry.display.includes(attachment.file),
  )
  return JSON.stringify([child?.revision, child?.hunks.map((hunk) => hunk.id)])
}

export function diffAttachmentLines(
  attachment: DiffAttachment,
): Readonly<Record<'old' | 'new', readonly string[] | null>> {
  if (attachment.file.isPartial) return { old: null, new: null }
  if (
    attachment.kind === 'snapshot' &&
    attachment.read.input.kind === 'checkpoint' &&
    attachment.child.kind === 'full'
  ) {
    return {
      old: attachment.child.old.kind === 'blob' ? splitTextLines(attachment.child.old.text) : [],
      new: attachment.child.new.kind === 'blob' ? splitTextLines(attachment.child.new.text) : [],
    }
  }
  return { old: attachment.file.oldLines, new: attachment.file.newLines }
}

export function diffAttachmentReferences(attachment: DiffAttachment): readonly object[] {
  if (attachment.kind === 'projection-control') return [attachment.file]
  if (attachment.kind === 'snapshot') return [attachment.child]
  if (attachment.kind === 'saved')
    return [attachment.read.live.snapshot, attachment.read.saved.snapshot]
  return [attachment.read.input.old.snapshot, attachment.read.input.new.snapshot]
}
