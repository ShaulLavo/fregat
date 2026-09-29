import type { EditorSyntaxThemeColor, EditorTheme } from '../theme'

export type EditorShikiThemeColorMode = 'dark' | 'light'

export type EditorShikiSyntaxScopeMapping = {
  readonly key: EditorSyntaxThemeColor
  readonly scopes: readonly string[]
}

export type EditorShikiThemeSettingLike = {
  readonly scope?: string | readonly string[]
  readonly settings?: {
    readonly foreground?: string
  }
}

export type EditorShikiTheme = {
  readonly bg: string
  readonly fg: string
  readonly colors: Readonly<Record<string, string | undefined>>
  readonly name: string
  readonly settings: readonly EditorShikiThemeSettingLike[]
  readonly tokenColors: readonly EditorShikiThemeSettingLike[]
  readonly type?: EditorShikiThemeColorMode
}

export type EditorThemeToShikiThemeOptions = {
  readonly fallbackBackground?: string
  readonly fallbackForeground?: string
  readonly name?: string
  readonly type?: EditorShikiThemeColorMode
}

const DEFAULT_BACKGROUND = '#1e1e1e'
const DEFAULT_FOREGROUND = '#d4d4d4'

export const EDITOR_SHIKI_SYNTAX_SCOPE_MAPPINGS = [
  {
    key: 'attribute',
    scopes: ['entity.other.attribute-name', 'meta.attribute', 'support.type.property-name'],
  },
  {
    key: 'bracket',
    scopes: ['punctuation.section', 'punctuation.definition', 'meta.brace'],
  },
  {
    key: 'comment',
    scopes: ['comment'],
  },
  {
    key: 'constant',
    scopes: [
      'constant.language',
      'constant.character',
      'constant.other',
      'variable.other.constant',
    ],
  },
  {
    key: 'function',
    scopes: ['entity.name.function', 'support.function', 'meta.function-call'],
  },
  {
    key: 'keyword',
    scopes: ['keyword', 'storage.modifier', 'storage.type', 'storage'],
  },
  {
    key: 'keywordDeclaration',
    scopes: ['keyword.declaration', 'storage.type', 'storage', 'keyword.operator.new'],
  },
  {
    key: 'keywordImport',
    scopes: [
      'keyword.control.import',
      'keyword.control.from',
      'keyword.operator.expression.import',
    ],
  },
  {
    key: 'namespace',
    scopes: ['entity.name.namespace', 'entity.name.module', 'support.module'],
  },
  {
    key: 'number',
    scopes: ['constant.numeric'],
  },
  {
    // The scope VS Code maps the `parameter` semantic type onto. Without a rule of its own a
    // parameter falls through to the theme's variable colour, which is what it looks like anyway.
    key: 'parameter',
    scopes: ['variable.parameter', 'meta.parameter', 'meta.function.parameters'],
  },
  {
    key: 'property',
    scopes: [
      'meta.property-name',
      'variable.other.property',
      'variable.argument.css',
      'meta.object-literal.key',
      'support.type.property-name',
    ],
  },
  {
    key: 'string',
    scopes: ['string', 'string.quoted'],
  },
  {
    key: 'type',
    scopes: [
      'support.type',
      'support.class',
      'entity.name.tag',
      'entity.name.type',
      'entity.name.class',
    ],
  },
  {
    key: 'typeDefinition',
    scopes: ['entity.name.type.class', 'entity.name.class', 'entity.name.type'],
  },
  {
    key: 'typeParameter',
    scopes: ['entity.name.type.type-parameter', 'meta.type.parameters'],
  },
  {
    key: 'variable',
    scopes: ['variable.other', 'variable.parameter', 'identifier'],
  },
  {
    key: 'variableBuiltin',
    scopes: ['variable.language', 'support.variable', 'support.constant'],
  },
] satisfies readonly EditorShikiSyntaxScopeMapping[]

export function editorThemeToShikiTheme(
  theme: EditorTheme,
  options: EditorThemeToShikiThemeOptions = {},
): EditorShikiTheme {
  const bg = theme.backgroundColor ?? options.fallbackBackground ?? DEFAULT_BACKGROUND
  const fg = theme.foregroundColor ?? options.fallbackForeground ?? DEFAULT_FOREGROUND
  const tokenColors = editorThemeToShikiTokenColors(theme, fg)
  const type = options.type

  return {
    bg,
    colors: {
      'editor.background': bg,
      'editor.foreground': fg,
    },
    fg,
    name: options.name ?? editorThemeToShikiThemeName(theme, type),
    settings: tokenColors,
    tokenColors,
    ...(type ? { type } : {}),
  }
}

export function editorThemeToShikiTokenColors(
  theme: EditorTheme,
  foreground: string,
): readonly EditorShikiThemeSettingLike[] {
  const tokenColors: EditorShikiThemeSettingLike[] = [
    { scope: ['source'], settings: { foreground } },
  ]

  for (const mapping of EDITOR_SHIKI_SYNTAX_SCOPE_MAPPINGS) {
    const color = theme.syntax?.[mapping.key]
    if (!color) continue

    tokenColors.push({
      scope: mapping.scopes,
      settings: { foreground: color },
    })
  }

  return tokenColors
}

function editorThemeToShikiThemeName(
  theme: EditorTheme,
  type: EditorShikiThemeColorMode | undefined,
): string {
  return `editor-${type ?? 'theme'}-${compactThemeHash(theme)}`
}

function compactThemeHash(theme: EditorTheme): string {
  const input = [
    theme.backgroundColor ?? '',
    theme.foregroundColor ?? '',
    ...EDITOR_SHIKI_SYNTAX_SCOPE_MAPPINGS.map(({ key }) => theme.syntax?.[key] ?? ''),
  ].join('|')

  return compactHash(input)
}

function compactHash(input: string): string {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index)
  }

  return (hash >>> 0).toString(36)
}
