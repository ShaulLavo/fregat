import type { DocumentKey, DocumentRef } from '@/lib/documents/utils/types'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import type { FileSnapshot } from '@/lib/file-snapshot'
import type { LoadState } from '@/lib/load-state'

export function readyFile(fileState: LoadState<FileSnapshot>) {
  if (fileState.status !== 'ready') return null

  return fileState.data
}

export function joinedEditorRenderDocument({
  analysis,
  buffer,
  documentKey,
  editability,
  target,
  preparedDocument,
  view,
}: {
  analysis?: EditorRenderDocument['analysis']
  buffer: EditorRenderDocument['buffer'] | null
  documentKey: DocumentKey | null
  editability: EditorRenderDocument['editability']
  target: DocumentRef | null
  preparedDocument?: EditorRenderDocument['preparedDocument']
  view: EditorRenderDocument['view'] | null
}): EditorRenderDocument | null {
  if (!buffer) return null
  if (!documentKey) return null
  if (!target) return null
  if (!view) return null

  return {
    analysis,
    buffer,
    editability,
    key: documentKey,
    target,
    preparedDocument,
    view,
  }
}
