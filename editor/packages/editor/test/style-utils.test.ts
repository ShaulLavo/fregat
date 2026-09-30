import { afterEach, describe, expect, it } from 'vitest'

import {
  buildHighlightRule,
  clamp,
  normalizeTokenStyle,
  serializeTokenStyle,
  SharedStyleRules,
} from '../src/style-utils'

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps below minimum', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
  })

  it('clamps above maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('handles min equal to max', () => {
    expect(clamp(5, 3, 3)).toBe(3)
  })
})

describe('serializeTokenStyle', () => {
  it('serializes all properties in deterministic order', () => {
    const a = serializeTokenStyle({ color: '#f00', fontWeight: 700 })
    const b = serializeTokenStyle({ fontWeight: 700, color: '#f00' })
    expect(a).toBe(b)
  })

  it('includes undefined keys as undefined in JSON', () => {
    const result = serializeTokenStyle({ color: '#f00' })
    const parsed = JSON.parse(result)
    expect(parsed.color).toBe('#f00')
    expect(parsed.backgroundColor).toBeUndefined()
  })
})

describe('normalizeTokenStyle', () => {
  it('returns null for empty style', () => {
    expect(normalizeTokenStyle({})).toBeNull()
  })

  it('strips falsy properties', () => {
    expect(normalizeTokenStyle({ color: '', fontWeight: 0 })).toBeNull()
  })

  it('keeps truthy properties', () => {
    expect(normalizeTokenStyle({ color: '#f00', fontStyle: 'italic' })).toEqual({
      color: '#f00',
      fontStyle: 'italic',
    })
  })

  it('preserves all style fields when present', () => {
    const style = {
      color: '#fff',
      backgroundColor: '#000',
      fontStyle: 'italic' as const,
      fontWeight: 700,
      textDecoration: 'underline',
    }
    expect(normalizeTokenStyle(style)).toEqual(style)
  })
})

describe('buildHighlightRule', () => {
  it('builds a CSS rule with color', () => {
    expect(buildHighlightRule('tok-0', { color: '#f00' })).toBe(
      '.editor-virtualized-row::highlight(tok-0) { color: #f00; }',
    )
  })

  it('builds a rule with multiple properties', () => {
    const rule = buildHighlightRule('tok-1', {
      color: '#fff',
      backgroundColor: '#000',
      textDecoration: 'underline',
    })
    expect(rule).toBe(
      '.editor-virtualized-row::highlight(tok-1) { color: #fff; background-color: #000; text-decoration: underline; }',
    )
  })

  // A ::highlight() rule can only apply colour, background-colour, text-decoration, text-shadow and
  // text-stroke. A font property emitted here is parsed and then ignored, so the rule claimed
  // something it never did — and for a style that declared nothing else, the whole rule was inert.
  it('emits no font declarations, because a highlight cannot apply them', () => {
    expect(
      buildHighlightRule('tok-3', { color: '#fff', fontStyle: 'italic', fontWeight: 700 }),
    ).toBe('.editor-virtualized-row::highlight(tok-3) { color: #fff; }')
    expect(buildHighlightRule('tok-4', { fontStyle: 'italic', fontWeight: 700 })).toBe(
      '.editor-virtualized-row::highlight(tok-4) {  }',
    )
  })

  // The other half of the split: dropping a font property from the CSS must not drop it from the
  // style's identity. Two tokens differing only in weight are two styles to a highlighter that has
  // real theme data, and collapsing them onto one key would paint the second with the first's rule.
  it('keeps font properties in the style key', () => {
    expect(serializeTokenStyle({ color: '#f00', fontWeight: 700 })).not.toBe(
      serializeTokenStyle({ color: '#f00', fontWeight: 400 }),
    )
    expect(serializeTokenStyle({ color: '#f00', fontStyle: 'italic' })).not.toBe(
      serializeTokenStyle({ color: '#f00', fontStyle: 'normal' }),
    )
  })

  it('skips falsy properties', () => {
    expect(buildHighlightRule('tok-2', { color: '' })).toBe(
      '.editor-virtualized-row::highlight(tok-2) {  }',
    )
  })
})

describe('SharedStyleRules', () => {
  afterEach(() => {
    document.head.querySelectorAll('style').forEach((element) => element.remove())
  })

  function ruleText(): string | null {
    return document.head.querySelector('style')?.textContent ?? null
  }

  it('writes nothing until the batch is flushed', () => {
    const rules = new SharedStyleRules(document)

    rules.acquire('a', '.a { color: red; }')
    expect(ruleText()).toBeNull()

    rules.flush()
    expect(ruleText()).toBe('.a { color: red; }')
  })

  it('keeps a rule until its last reference is released', () => {
    const rules = new SharedStyleRules(document)

    rules.acquire('a', '.a { color: red; }')
    rules.acquire('a', '.a { color: red; }')
    rules.flush()

    expect(rules.release('a')).toBe(false)
    rules.flush()
    expect(ruleText()).toBe('.a { color: red; }')

    expect(rules.release('a')).toBe(true)
    rules.flush()
    expect(ruleText()).toBeNull()

    expect(rules.release('a')).toBe(false)
  })

  it('ignores the rule text of an id it already holds', () => {
    const rules = new SharedStyleRules(document)

    rules.acquire('a', '.a { color: red; }')
    rules.acquire('a', '.a { color: blue; }')
    rules.flush()

    expect(ruleText()).toBe('.a { color: red; }')
  })

  it('rewrites the stylesheet after it is removed from the document', () => {
    const rules = new SharedStyleRules(document)

    rules.acquire('a', '.a { color: red; }')
    rules.flush()
    document.head.querySelectorAll('style').forEach((element) => element.remove())

    rules.restore()
    expect(ruleText()).toBe('.a { color: red; }')
  })
})
