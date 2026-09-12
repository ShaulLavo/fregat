export type EditorDiffViewMode = 'split' | 'stacked'

export const DEFAULT_DIFF_VIEW_MODE: EditorDiffViewMode = 'stacked'

export function nextEditorDiffViewMode(mode: EditorDiffViewMode): EditorDiffViewMode {
  if (mode === 'split') return 'stacked'

  return 'split'
}
