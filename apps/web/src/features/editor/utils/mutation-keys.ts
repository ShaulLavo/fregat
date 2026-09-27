import type { DocumentKey } from '@/lib/documents/utils/types'

export const editorMutationKeys = {
  place: (scope: string) => ['editor', 'groups', 'place', scope] as const,
  resize: (scope: string) => ['editor', 'groups', 'resize', scope] as const,
  historyForget: (key: DocumentKey) => ['editor', 'history', 'forget', key] as const,
  historyPersist: (key: DocumentKey) => ['editor', 'history', 'persist', key] as const,
  historyPrune: () => ['editor', 'history', 'prune'] as const,
  historyClear: (key: DocumentKey) => ['editor', 'history', 'clear', key] as const,
  historyRestore: (key: DocumentKey) => ['editor', 'history', 'restore', key] as const,
  save: (key: DocumentKey) => ['editor', 'save', key] as const,
  saves: () => ['editor', 'save'] as const,
  treeSitterWarmUp: () => ['editor', 'tree-sitter', 'warm-up'] as const,
  diffSyntaxPrepare: () => ['editor', 'diff-syntax', 'prepare'] as const,
}

export const EDITOR_SAVE_SCOPE = 'editor.save'
