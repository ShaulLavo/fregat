import { registerEditorColor, type EditorColorDefaults } from '@singapore-editor/core/rendering'

const colors = {
  added: { dark: '#5ecc71', light: '#166534' },
  deleted: { dark: '#ff6762', light: '#991b1b' },
  modified: { dark: '#69b1ff', light: '#0369a1' },
  'added.bg': 'color-mix(in srgb, var(--editor-background, #1e1e1e) 78%, var(--editor-diff-added))',
  'deleted.bg':
    'color-mix(in srgb, var(--editor-background, #1e1e1e) 78%, var(--editor-diff-deleted))',
  'hunk.bg':
    'color-mix(in srgb, var(--editor-background, #1e1e1e) 84%, var(--editor-diff-modified))',
  'placeholder.bg': {
    dark: 'color-mix(in srgb, var(--editor-background, #1e1e1e) 92%, #ffffff)',
    light: 'color-mix(in srgb, var(--editor-background, #ffffff) 92%, #000000)',
  },
  border: { dark: '#3f3f46', light: '#d4d4d8' },
  'split.handle': '#71717a',
  muted: { dark: '#a1a1aa', light: '#52525b' },
  'hunk.foreground': { dark: '#9cdcfe', light: '#0369a1' },
} satisfies Record<string, EditorColorDefaults>

export function registerDiffColors(): void {
  for (const [id, fallback] of Object.entries(colors)) registerEditorColor(`diff.${id}`, fallback)
}
