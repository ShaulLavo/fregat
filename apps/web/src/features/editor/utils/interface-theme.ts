import type { EditorTheme } from '@singapore-editor/core/rendering'

export function interfaceTheme(theme: EditorTheme): EditorTheme {
  return {
    ...theme,
    selectionColor: 'color-mix(in oklch, var(--info) 35%, transparent)',
    inactiveSelectionColor: 'var(--editor-inactive-selection)',
    popupBackgroundColor: 'var(--popover-solid)',
    colors: {
      ...theme.colors,
      'diff.added': 'var(--diff-added)',
      'diff.deleted': 'var(--diff-removed)',
      'diff.modified': 'var(--info)',
      'diff.hunk.foreground': 'var(--info)',
      'diff.border': 'var(--border)',
      'diff.muted': 'var(--muted-foreground)',
      'diff.split.handle': 'var(--border)',
      'diff.added.bg': 'color-mix(in oklch, var(--diff-added) 9%, transparent)',
      'diff.deleted.bg': 'color-mix(in oklch, var(--diff-removed) 9%, transparent)',
      'diff.hunk.bg': 'color-mix(in oklch, var(--info) 7%, transparent)',
      'diff.placeholder.bg': 'color-mix(in oklch, var(--muted-foreground) 5%, transparent)',
    },
  }
}
