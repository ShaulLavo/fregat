import { createTextDiff, splitTextLines } from '@singapore-editor/diff'
import type { DiffAttachment } from '@/lib/diff-attachment'
import type { SavedComparisonRead } from '@/lib/saved-comparison'
import type { SnapshotComparisonRead, FilesystemComparisonInput } from '@/lib/snapshot-comparison'
import { materializeFileSnapshotText } from '@/lib/file-snapshot'
import { languageIdForFilePath } from '@/lib/file-language'

type ReadyComparison = Extract<SnapshotComparisonRead, { kind: 'ready' }>
type ReadyFilesystem = ReadyComparison & { readonly input: FilesystemComparisonInput }
type ReadySaved = Extract<SavedComparisonRead, { kind: 'ready' }>

export function savedDiffAttachment(read: ReadySaved): DiffAttachment {
  const path = read.saved.snapshot.path
  const languageId = languageIdForFilePath(path)
  const file = createTextDiff({
    newFile: { languageId, path, text: read.live.snapshot.materializeFullText() },
    oldFile: { languageId, path, text: materializeFileSnapshotText(read.saved.snapshot) },
  })
  return { kind: 'saved', read, file }
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
