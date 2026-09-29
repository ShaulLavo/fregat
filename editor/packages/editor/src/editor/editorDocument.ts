import type { DocumentSession } from '../documentSession'
import { createDocumentSession, createStaticDocumentSession } from '../documentSession'
import type {
  EditorDocumentMode,
  EditorEditability,
  EditorScrollPosition,
  EditorSelectionSyncMode,
} from './types'

const DEFAULT_EDITABILITY: EditorEditability = 'editable'
const DEFAULT_DOCUMENT_MODE: EditorDocumentMode = 'session'
const DEFAULT_SELECTION_SYNC_MODE: EditorSelectionSyncMode = 'sync'

export type ResetOwnedDocumentOptions = {
  readonly documentId: string | null
  readonly persistentIdentity: boolean
  readonly scrollPosition?: EditorScrollPosition
}

export function createEditorDocumentSession(
  text: string,
  documentMode: EditorDocumentMode,
): DocumentSession {
  if (documentMode === 'static') return createStaticDocumentSession(text)
  return createDocumentSession(text)
}

export function normalizeEditorEditability(
  value: EditorEditability | undefined,
): EditorEditability {
  if (value === 'readonly') return 'readonly'
  return DEFAULT_EDITABILITY
}

export function normalizeEditorDocumentMode(
  value: EditorDocumentMode | undefined,
): EditorDocumentMode {
  if (value === 'static') return 'static'
  return DEFAULT_DOCUMENT_MODE
}

export function normalizeEditorSelectionSyncMode(
  value: EditorSelectionSyncMode | undefined,
): EditorSelectionSyncMode {
  if (value === 'none') return 'none'
  return DEFAULT_SELECTION_SYNC_MODE
}
