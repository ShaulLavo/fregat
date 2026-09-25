import {
  BUNDLED_FONTS,
  DEFAULT_CODE_FONT,
  DEFAULT_UI_FONT,
  NERD_SYMBOLS_FONT,
  cssFamily,
  fontFamilyName,
  parseFontRef,
  type FontRef,
  type FontRole,
} from '@workspace/contracts'

const UI_FALLBACK = [
  cssFamily(BUNDLED_FONTS.inter.family),
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'sans-serif',
]
const CODE_FALLBACK = [
  cssFamily(BUNDLED_FONTS['jetbrains-mono'].family),
  'ui-monospace',
  'SFMono-Regular',
  'monospace',
]

/**
 * The CSS stack for a font setting. A font that will not download degrades to the bundled face
 * for its role, never to the browser's proportional default.
 */
export function fontStack(value: string, role: FontRole): string {
  const ref = roleFontRef(value, role)
  const families = [
    cssFamily(fontFamilyName(ref)),
    ...(role === 'code' && needsNerdSymbols(ref) ? [nerdSymbolsFamily()] : []),
    ...(role === 'ui' ? UI_FALLBACK : CODE_FALLBACK),
  ]
  return [...new Set(families)].join(', ')
}

/** A stored value the schema rejected still renders, in the role's default. */
function roleFontRef(value: string, role: FontRole): FontRef {
  return parseFontRef(value) ?? parseFontRef(role === 'ui' ? DEFAULT_UI_FONT : DEFAULT_CODE_FONT)!
}

/** Prompt and file-type glyphs come from a Nerd Font; any other code font borrows them. */
function needsNerdSymbols(ref: FontRef): boolean {
  return ref.source !== 'nerd'
}

function nerdSymbolsFamily() {
  return cssFamily(fontFamilyName(parseFontRef(NERD_SYMBOLS_FONT)!))
}

/** Every face the current settings draw with, so boot and the provider start the same set. */
export function fontsInUse(
  values: Readonly<Record<'workbench.fontFamily' | 'editor.fontFamily', string>>,
): string[] {
  const code = roleFontRef(values['editor.fontFamily'], 'code')
  return [
    values['workbench.fontFamily'],
    values['editor.fontFamily'],
    ...(needsNerdSymbols(code) ? [NERD_SYMBOLS_FONT] : []),
  ]
}
