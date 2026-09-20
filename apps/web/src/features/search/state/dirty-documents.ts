import { matchesWorkspaceRoot as isPathInWorkspace } from '@/lib/path-formatters'
import type { DocumentKey } from '@/lib/documents/utils/types'
import type { LiveEditorDocument } from '@/features/editor/state/document-state'
import type { OpenBufferSearchDocument } from '@/features/search/utils/providers'
import { compareSearchPaths } from '@/features/search/utils/sort'

export function dirtySearchDocuments(
  documents: Readonly<Record<DocumentKey, LiveEditorDocument>>,
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
  rootPath: string,
) {
  const dirtyDocuments: OpenBufferSearchDocument[] = []

  for (const key of dirtyDocumentKeys) {
    const document = documents[key]
    if (document?.target.kind !== 'file') continue
    const path = document.target.resource.path
    if (!isPathInWorkspace(path, rootPath)) continue
    dirtyDocuments.push({ path, text: document.buffer.materializeFullText() })
  }

  return dirtyDocuments.sort((a, b) => compareSearchPaths(a.path, b.path))
}

export function dirtySearchRevisionKey(
  documents: Readonly<Record<DocumentKey, LiveEditorDocument>>,
  dirtyDocumentKeys: ReadonlySet<DocumentKey>,
  contentRevisions: Readonly<Record<DocumentKey, string>>,
  rootPath: string,
) {
  const parts: string[] = []
  const dirtyFiles = Array.from(dirtyDocumentKeys)
    .flatMap((key) => {
      const document = documents[key]
      if (document?.target.kind !== 'file') return []
      const path = document.target.resource.path
      return isPathInWorkspace(path, rootPath) ? [{ document, key, path }] : []
    })
    .toSorted((left, right) => compareSearchPaths(left.path, right.path))

  for (const { document, key, path } of dirtyFiles) {
    parts.push(
      path,
      liveDocumentSnapshotRevision(document),
      contentRevisions[key] ?? '',
      dirtySearchBufferKey(document.buffer),
    )
  }

  return parts.join('\0')
}

const dirtySearchBufferKeys = new WeakMap<LiveEditorDocument['buffer'], number>()
let nextDirtySearchBufferKey = 1

function dirtySearchBufferKey(buffer: LiveEditorDocument['buffer']) {
  const existing = dirtySearchBufferKeys.get(buffer)
  if (existing !== undefined) return existing.toString()

  const key = nextDirtySearchBufferKey
  nextDirtySearchBufferKey += 1
  dirtySearchBufferKeys.set(buffer, key)
  return key.toString()
}

function liveDocumentSnapshotRevision(document: LiveEditorDocument) {
  if (document.sync.kind === 'file') return document.sync.mtimeMs.toString()

  return document.localRevision.toString()
}
