import type { DocumentKey } from '@/lib/documents/utils/types'

export const editorMutationKeys = {
  save: (key: DocumentKey) => ['editor', 'save', key] as const,
  saves: () => ['editor', 'save'] as const,
}

export const EDITOR_SAVE_SCOPE = 'editor.save'
