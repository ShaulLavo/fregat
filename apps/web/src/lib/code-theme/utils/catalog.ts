import type { EditorTheme } from '@singapore-editor/core'
import { VSCODE_THEMES, type VscodeThemeDefinition } from '@singapore-editor/core/shiki'

export type EditorColorModeType = 'dark' | 'light'

export type BuiltinEditorThemeDefinition = {
  readonly editorTheme: EditorTheme
  readonly id: string
  readonly label: string
  readonly type: EditorColorModeType
}

export type EditorThemeOption = {
  readonly id: string
  readonly label: string
  readonly source: 'built-in' | 'vscode'
  readonly subtitle: string
  readonly type: EditorColorModeType
}

/**
 * The editor's own palettes. They color tree-sitter's captures — one color per
 * capture kind — where a VSCode theme colors TextMate scopes through shiki. That
 * is why picking one is not just a palette swap: shiki has to be off the document
 * entirely for tree-sitter's tokens to reach the screen. See
 * `editorSyntaxHighlightingSource`.
 */
const BUILTIN_EDITOR_THEMES = [
  {
    id: 'tree-sitter-dark',
    label: 'Native Dark',
    type: 'dark',
    editorTheme: {
      backgroundColor: '#1e1e1e',
      foregroundColor: '#d4d4d4',
      gutterBackgroundColor: '#1e1e1e',
      gutterForegroundColor: '#71717a',
      caretColor: '#d4d4d4',
      minimapBackgroundColor: '#1e1e1e',
      syntax: {
        attribute: '#99f6e4',
        bracket: '#d4d4d8',
        comment: '#71717a',
        constant: '#f0abfc',
        function: '#fecdd3',
        keyword: '#6ee7b7',
        keywordDeclaration: '#a78bfa',
        keywordImport: '#f9a8d4',
        namespace: '#a5f3fc',
        number: '#c4b5fd',
        property: '#e9d5ff',
        string: '#fde68a',
        type: '#7dd3fc',
        typeDefinition: '#38bdf8',
        typeParameter: '#5eead4',
        variable: '#e4e4e7',
        variableBuiltin: '#fdba74',
      },
    },
  },
  {
    id: 'tree-sitter-light',
    label: 'Native Light',
    type: 'light',
    editorTheme: {
      backgroundColor: '#ffffff',
      foregroundColor: '#24292e',
      gutterBackgroundColor: '#ffffff',
      gutterForegroundColor: '#6e7781',
      caretColor: '#24292e',
      minimapBackgroundColor: '#ffffff',
      syntax: {
        attribute: '#0f766e',
        bracket: '#57606a',
        comment: '#6e7781',
        constant: '#8250df',
        function: '#be123c',
        keyword: '#15803d',
        keywordDeclaration: '#7e22ce',
        keywordImport: '#db2777',
        namespace: '#0891b2',
        number: '#7c3aed',
        property: '#6b21a8',
        string: '#92400e',
        type: '#0369a1',
        typeDefinition: '#0284c7',
        typeParameter: '#0f766e',
        variable: '#24292e',
        variableBuiltin: '#c2410c',
      },
    },
  },
] as const satisfies readonly BuiltinEditorThemeDefinition[]

const builtinThemeById = new Map<string, BuiltinEditorThemeDefinition>(
  BUILTIN_EDITOR_THEMES.map((theme) => [theme.id, theme]),
)
const vscodeThemeById = new Map<string, VscodeThemeDefinition>(
  VSCODE_THEMES.map((theme) => [theme.id, theme]),
)

export function builtinEditorTheme(themeId: string): BuiltinEditorThemeDefinition | undefined {
  return builtinThemeById.get(themeId)
}

export function isBuiltinEditorThemeId(themeId: string): boolean {
  return builtinThemeById.has(themeId)
}

/**
 * Every selectable theme for one color mode, the built-ins first. Only the
 * built-ins carry a subtitle — a VSCode theme's id says nothing its label does
 * not, and it is already searchable through the row's keywords.
 */
export function editorThemeOptions(type: EditorColorModeType): readonly EditorThemeOption[] {
  const builtins = BUILTIN_EDITOR_THEMES.filter((theme) => theme.type === type).map(
    (theme) =>
      ({
        id: theme.id,
        label: theme.label,
        source: 'built-in',
        subtitle: 'Built-in',
        type: theme.type,
      }) satisfies EditorThemeOption,
  )
  const vscode = VSCODE_THEMES.filter((theme) => theme.type === type).map(
    (theme) =>
      ({
        id: theme.id,
        label: theme.label,
        source: 'vscode',
        subtitle: '',
        type: theme.type,
      }) satisfies EditorThemeOption,
  )

  return [...builtins, ...vscode]
}

export function editorThemeColorMode(themeId: string): EditorColorModeType | undefined {
  return builtinThemeById.get(themeId)?.type ?? vscodeThemeById.get(themeId)?.type
}
