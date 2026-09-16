import type { DocumentKey } from '@/lib/documents/utils/types'

export const editorMutationKeys = {
  historyClear: (key: DocumentKey) => ['editor', 'history', 'clear', key] as const,
  historyRestore: (key: DocumentKey) => ['editor', 'history', 'restore', key] as const,
  save: (key: DocumentKey) => ['editor', 'save', key] as const,
  saves: () => ['editor', 'save'] as const,
}

export const EDITOR_SAVE_SCOPE = 'editor.save'
