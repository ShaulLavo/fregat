import type { DocumentKey } from '@/lib/documents/utils/types'

export const editorMutationKeys = {
  performanceRecording: ['editor', 'performance-recording', 'module'] as const,
  previewDiffModule: ['editor', 'workspace-edit-preview', 'module'] as const,
  place: (scope: string) => ['editor', 'groups', 'place', scope] as const,
  resize: (scope: string) => ['editor', 'groups', 'resize', scope] as const,
  historyForget: (key: DocumentKey) => ['editor', 'history', 'forget', key] as const,
  historyPersist: (key: DocumentKey) => ['editor', 'history', 'persist', key] as const,
  historyPrune: () => ['editor', 'history', 'prune'] as const,
  historyClear: (key: DocumentKey) => ['editor', 'history', 'clear', key] as const,
  analysisRetention: () => ['editor', 'analysis', 'retention'] as const,
  historyRestore: (key: DocumentKey) => ['editor', 'history', 'restore', key] as const,
  save: (key: DocumentKey) => ['editor', 'save', key] as const,
  saves: () => ['editor', 'save'] as const,
  diffSyntaxPrepare: () => ['editor', 'diff-syntax', 'prepare'] as const,
  savedComparison: (scope: string) => ['editor', 'saved-comparison', 'adopt', scope] as const,
}

export const EDITOR_SAVE_SCOPE = 'editor.save'
