import type { DocumentKey, DocumentRef } from '@/lib/documents/utils/types'
import type { EditorRenderDocument } from '@/features/editor/utils/render-document'
import type { FileResult } from '@/lib/file-system-types'
import type { LoadState } from '@/lib/load-state'

export function readyFile(fileState: LoadState<FileResult>) {
  if (fileState.status !== 'ready') return null

  return fileState.data
}

export function joinedEditorRenderDocument({
  buffer,
  documentKey,
  editability,
  target,
  preparedDocument,
  view,
}: {
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
    buffer,
    editability,
    key: documentKey,
    target,
    preparedDocument,
    view,
  }
}
