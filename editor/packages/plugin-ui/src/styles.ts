import {
  editorColorReference,
  registerEditorColor,
  transparentEditorColor,
} from '@singapore-editor/core/rendering'

/*
 * Every colour a shared surface paints with is a registered id, so a host restyles the hover
 * through the editor theme instead of forking this package.
 */
export const HOVER_COLORS = {
  background: registerEditorColor('hover.background', {
    dark: '#252526',
    light: '#f3f3f3',
  }),
  foreground: registerEditorColor('hover.foreground', editorColorReference('foreground')),
  border: registerEditorColor(
    'hover.border',
    transparentEditorColor(editorColorReference('foreground'), 0.28),
  ),
  shadow: registerEditorColor('hover.shadow', {
    dark: '#0000005c',
    light: '#00000029',
  }),
  separator: registerEditorColor(
    'hover.separator',
    transparentEditorColor(editorColorReference('foreground'), 0.18),
  ),
  secondaryForeground: registerEditorColor(
    'hover.secondaryForeground',
    transparentEditorColor(editorColorReference('foreground'), 0.72),
  ),
  actionSuccess: registerEditorColor('hover.actionSuccess', {
    dark: '#86efac',
    light: '#15803d',
  }),
  actionFailure: registerEditorColor('hover.actionFailure', {
    dark: '#ef4444',
    light: '#dc2626',
  }),
} as const

/** The variables the hover reads, for a surface mounted outside the editor's cascade. */
export const HOVER_THEME_VARIABLES = [
  '--editor-hover-background',
  '--editor-hover-foreground',
  '--editor-hover-border',
  '--editor-hover-shadow',
  '--editor-hover-separator',
  '--editor-hover-secondary-foreground',
  '--editor-hover-action-success',
  '--editor-hover-action-failure',
] as const
