import { describe, expect, it } from 'vitest'

import { createSemanticTokenStyles } from '../src/syntax'

/**
 * The twenty-three token types LSP itself defines. Written out here rather than imported from
 * `@singapore-editor/lsp` on purpose: the editor does not depend on that package, and a second copy of the
 * list is what catches the two drifting apart.
 */
const STANDARD_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator',
] as const

describe('semantic token styles', () => {
  const styles = createSemanticTokenStyles()

  it('gives every standard token type a colour', () => {
    for (const tokenType of STANDARD_TOKEN_TYPES) {
      expect(styles.resolve(tokenType)?.color, tokenType).toBeTruthy()
    }
  })

  it('gives them colours that are not all the same', () => {
    const colours = new Set(
      STANDARD_TOKEN_TYPES.map((tokenType) => styles.resolve(tokenType)?.color),
    )

    expect(colours.size).toBeGreaterThan(10)
  })

  it('declares no font properties, which a highlight cannot apply', () => {
    for (const tokenType of STANDARD_TOKEN_TYPES) {
      const style = styles.resolve(tokenType)
      expect(style && 'fontStyle' in style, tokenType).toBe(false)
      expect(style && 'fontWeight' in style, tokenType).toBe(false)
    }
  })

  /**
   * The fall-through the whole contract rests on. A server's legend is unknown at design time and
   * runs to fifty-plus custom names; a name nothing claims paints nothing, and the syntactic layer
   * shows through unchanged. Guessing a colour would be worse than showing none.
   */
  it('resolves an unknown name to null rather than to a guess', () => {
    expect(styles.resolve('zigBuiltinCall')).toBeNull()
    expect(styles.resolve('')).toBeNull()
  })

  it('resolves a custom name through a host-supplied alias', () => {
    const aliased = createSemanticTokenStyles({
      scopeAliases: { zigBuiltinCall: 'macro', typstLabel: 'decorator' },
    })

    expect(aliased.resolve('zigBuiltinCall')).toEqual(styles.resolve('macro'))
    expect(aliased.resolve('typstLabel')).toEqual(styles.resolve('decorator'))
    // Aliasing one name says nothing about any other: the rest still fall through.
    expect(aliased.resolve('typstRef')).toBeNull()
  })

  it('carries an alias into the modifier axis too', () => {
    const aliased = createSemanticTokenStyles({ scopeAliases: { zigConst: 'variable' } })

    expect(aliased.scopeFor('zigConst', ['readonly'])).toBe('variable.readonly')
    expect(aliased.resolve('zigConst', ['readonly'])).toEqual(
      styles.resolve('variable', ['readonly']),
    )
  })
})

describe('the modifier axis', () => {
  const styles = createSemanticTokenStyles()

  /**
   * An LSP token carries a *set* of modifiers; the scope trie indexes a *sequence*. Rather than
   * build a second matcher for subset scoring, exactly one modifier reaches the scope — the
   * highest-ranked one present — so a set resolves the same way however it was ordered.
   */
  it('emits only the highest-ranked modifier present', () => {
    expect(styles.scopeFor('variable', ['readonly'])).toBe('variable.readonly')
    expect(styles.scopeFor('variable', ['readonly', 'local'])).toBe('variable.readonly')
    expect(styles.scopeFor('variable', ['local', 'readonly'])).toBe('variable.readonly')
    expect(styles.scopeFor('variable', [])).toBe('variable')
    expect(styles.scopeFor('variable')).toBe('variable')
  })

  /**
   * The ranking rule, and the regression it exists to stop.
   *
   * A modifier the table has no rule for resolves to exactly the base scope, so choosing one is
   * harmless in itself and harmful only in what it displaces. TypeScript sets
   * `{declaration, readonly, local}` on the declaration site of a `const` and `{readonly, local}` on
   * every reference to it — so with `declaration` ranked first, `const MAX = 10` painted as a plain
   * variable while `MAX` two lines below painted as a constant, and the syntactic layer (which
   * resolves an all-caps identifier to the constant colour at both) was overpainted at one of them.
   */
  it('prefers a modifier the table has a rule for over one it does not', () => {
    expect(styles.scopeFor('variable', ['declaration', 'readonly'])).toBe('variable.readonly')
    expect(styles.scopeFor('variable', ['readonly', 'declaration', 'local'])).toBe(
      'variable.readonly',
    )
    expect(styles.scopeFor('function', ['declaration', 'defaultLibrary'])).toBe(
      'function.defaultLibrary',
    )
    // The declaration site and every reference to it resolve alike, which is the point.
    expect(styles.resolve('variable', ['declaration', 'readonly', 'local'])).toEqual(
      styles.resolve('variable', ['readonly', 'local']),
    )
  })

  it('resolves a modifier set the same way whatever order it arrived in', () => {
    expect(styles.resolve('variable', ['readonly', 'local'])).toEqual(
      styles.resolve('variable', ['readonly']),
    )
    expect(styles.resolve('variable', ['local', 'readonly'])).toEqual(
      styles.resolve('variable', ['readonly']),
    )
  })

  it('distinguishes a modifier the table declares from the bare type', () => {
    expect(styles.resolve('variable', ['readonly'])).not.toEqual(styles.resolve('variable'))
    expect(styles.resolve('variable', ['defaultLibrary'])).not.toEqual(styles.resolve('variable'))
  })

  /**
   * A modifier the table does not declare inherits from its type rather than resolving to nothing:
   * the trie walks as far as it can and returns the nearest styled ancestor, so an unfamiliar
   * modifier costs a shade of colour and never the colour itself.
   */
  it('falls back to the bare type for a modifier nothing declares', () => {
    expect(styles.resolve('variable', ['async'])).toEqual(styles.resolve('variable'))
    expect(styles.resolve('keyword', ['documentation'])).toEqual(styles.resolve('keyword'))
  })

  it('ranks an unlisted modifier below every listed one, and orders ties by name', () => {
    expect(styles.scopeFor('variable', ['zigInline', 'readonly'])).toBe('variable.readonly')
    expect(styles.scopeFor('variable', ['zigInline', 'astroScoped'])).toBe('variable.astroScoped')
    expect(styles.scopeFor('variable', ['astroScoped', 'zigInline'])).toBe('variable.astroScoped')
  })
})

describe('the z-index the layer stacks in', () => {
  it('is carried onto every resolved style', () => {
    const styles = createSemanticTokenStyles({ zIndex: 1 })

    expect(styles.resolve('variable')?.zIndex).toBe(1)
    expect(styles.resolve('variable', ['readonly'])?.zIndex).toBe(1)
  })

  it('is absent when nobody asked for one', () => {
    const style = createSemanticTokenStyles().resolve('variable')

    expect(style && 'zIndex' in style).toBe(false)
  })
})
