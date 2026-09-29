import { applyEditorTheme } from '@singapore-editor/core/rendering'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LanguageServerDiagnosticSeverity } from '../src/diagnostics'
import {
  DIAGNOSTIC_MARKER_COLORS,
  DIAGNOSTIC_STYLES,
  LINK_HIGHLIGHT_STYLE,
} from '../src/plugin.styles'

type ThemeCanvas = 'dark' | 'light'

const SEVERITIES: readonly LanguageServerDiagnosticSeverity[] = [
  'error',
  'warning',
  'information',
  'hint',
]

// Applying any theme is what makes the registry emit its defaults as rules; the rules are the only
// place the values exist, since a style paints with a variable and never with a colour.
beforeAll(() => {
  applyEditorTheme(document.createElement('div'), null)
})

describe('registered language server colours', () => {
  it('resolves to the palette on the canvas the editor ships with', () => {
    expect(resolve(LINK_HIGHLIGHT_STYLE.color, 'dark')).toBe('#60a5fa')
    expect(resolve(LINK_HIGHLIGHT_STYLE.textDecoration, 'dark')).toBe('underline solid #60a5fa')

    expect(resolve(DIAGNOSTIC_STYLES.error.color, 'dark')).toBe('#ef4444')
    expect(resolve(DIAGNOSTIC_STYLES.error.textDecoration, 'dark')).toBe(
      'underline wavy color-mix(in srgb, #ef4444 80%, black)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.error.backgroundColor, 'dark')).toBe(
      'color-mix(in srgb, #ef4444 16%, transparent)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.warning.backgroundColor, 'dark')).toBe(
      'color-mix(in srgb, #f59e0b 26%, transparent)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.information.backgroundColor, 'dark')).toBe(
      'color-mix(in srgb, #3b82f6 22%, transparent)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.hint.backgroundColor, 'dark')).toBe(
      'color-mix(in srgb, color-mix(in srgb, #94a3b8 80%, black) 22%, transparent)',
    )
  })

  it('moves every value away from a light canvas instead of reusing the dark one', () => {
    expect(resolve(LINK_HIGHLIGHT_STYLE.color, 'light')).toBe('#2563eb')
    expect(resolve(LINK_HIGHLIGHT_STYLE.textDecoration, 'light')).toBe('underline solid #2563eb')

    expect(resolve(DIAGNOSTIC_STYLES.error.color, 'light')).toBe('#dc2626')
    expect(resolve(DIAGNOSTIC_STYLES.error.textDecoration, 'light')).toBe(
      'underline wavy color-mix(in srgb, #dc2626 80%, black)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.error.backgroundColor, 'light')).toBe(
      'color-mix(in srgb, #dc2626 16%, transparent)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.warning.backgroundColor, 'light')).toBe(
      'color-mix(in srgb, #b45309 26%, transparent)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.information.backgroundColor, 'light')).toBe(
      'color-mix(in srgb, #1d4ed8 22%, transparent)',
    )
    expect(resolve(DIAGNOSTIC_STYLES.hint.backgroundColor, 'light')).toBe(
      'color-mix(in srgb, color-mix(in srgb, #94a3b8 80%, white) 22%, transparent)',
    )
  })

  it('leaves the navigation affordance transparent so syntax colouring shows through', () => {
    expect(resolve(LINK_HIGHLIGHT_STYLE.backgroundColor, 'dark')).toBe('transparent')
  })
})

describe('minimap marker palette', () => {
  it('marks a line in the hue that severity washes the range with', () => {
    for (const severity of SEVERITIES) {
      const wash = resolve(DIAGNOSTIC_STYLES[severity].backgroundColor, 'dark')
      expect(rgbChannels(DIAGNOSTIC_MARKER_COLORS[severity]), severity).toBe(hexChannels(wash))
    }
  })

  it('fades the marker as the severity drops', () => {
    expect(DIAGNOSTIC_MARKER_COLORS).toEqual({
      error: 'rgba(239, 68, 68, 1)',
      warning: 'rgba(245, 158, 11, 0.95)',
      information: 'rgba(59, 130, 246, 0.9)',
      hint: 'rgba(148, 163, 184, 0.85)',
    })
  })
})

/** What a style's value works out to once every variable in it is followed to its default. */
function resolve(value: string | undefined, canvas: ThemeCanvas): string {
  return expandReferences(value ?? '', declaredColors(canvas))
}

// The rules keyed by declared type are read rather than the ones keyed by the viewer's preference:
// both carry the same value, and only these two sit unwrapped on a line of their own.
function declaredColors(canvas: ThemeCanvas): ReadonlyMap<string, string> {
  const rules = [...document.head.querySelectorAll('style')]
    .map((element) => element.textContent ?? '')
    .join('\n')
  const pattern = new RegExp(
    `^\\[data-editor-theme-type='${canvas}'\\] \\{ (--editor-[a-z0-9-]+): (.+); \\}$`,
    'gm',
  )
  return new Map([...rules.matchAll(pattern)].map((match) => [match[1] ?? '', match[2] ?? '']))
}

function expandReferences(value: string, declared: ReadonlyMap<string, string>): string {
  const start = value.indexOf('var(')
  if (start === -1) return value

  const end = closingParenthesis(value, start + 3)
  const [name, fallback] = splitReference(value.slice(start + 4, end))
  const target = declared.get(name) ?? fallback
  const tail = expandReferences(value.slice(end + 1), declared)
  return `${value.slice(0, start)}${expandReferences(target, declared)}${tail}`
}

function splitReference(reference: string): readonly [string, string] {
  const comma = reference.indexOf(',')
  if (comma === -1) return [reference.trim(), '']
  return [reference.slice(0, comma).trim(), reference.slice(comma + 1).trim()]
}

function closingParenthesis(value: string, open: number): number {
  let depth = 0
  for (let index = open; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    if (value[index] !== ')') continue

    depth -= 1
    if (depth === 0) return index
  }
  return value.length
}

function rgbChannels(color: string): string {
  return color.slice(color.indexOf('(') + 1, color.lastIndexOf(',')).trim()
}

/** The channels of the first colour literal in `value`, which is the hue anything derived shares. */
function hexChannels(value: string): string {
  const hex = /#[0-9a-f]{6}/i.exec(value)?.[0]
  if (!hex) throw new Error(`no colour literal in ${value}`)

  const channels = Number.parseInt(hex.slice(1), 16)
  return [(channels >> 16) & 0xff, (channels >> 8) & 0xff, channels & 0xff].join(', ')
}
