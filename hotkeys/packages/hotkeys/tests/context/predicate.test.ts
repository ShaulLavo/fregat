// Translated from Zed's crates/gpui/src/keymap/context.rs tests (zed-industries/zed@933d8d9).
import { describe, expect, it } from 'vitest'
import {
  createKeyContext,
  evaluatePredicate,
  parseContextPredicate,
  parseKeyContext,
  predicateDepth,
} from '../../src'
import type { ContextPredicate } from '../../src'

const id = (name: string): ContextPredicate => ({ kind: 'identifier', name })
const not = (predicate: ContextPredicate): ContextPredicate => ({ kind: 'not', predicate })
const and = (left: ContextPredicate, right: ContextPredicate): ContextPredicate => ({
  kind: 'and',
  left,
  right,
})
const or = (left: ContextPredicate, right: ContextPredicate): ContextPredicate => ({
  kind: 'or',
  left,
  right,
})
const eq = (key: string, value: string): ContextPredicate => ({ kind: 'equal', key, value })
const neq = (key: string, value: string): ContextPredicate => ({ kind: 'not-equal', key, value })
const ctx = (source: string) => parseKeyContext(source)
const evaluate = (source: string, stack: readonly string[]) =>
  evaluatePredicate(parseContextPredicate(source), stack.map(ctx))

describe('parseKeyContext', () => {
  it('reads identifiers and key=value pairs with any spacing', () => {
    const expected = createKeyContext({ identifiers: ['baz'], values: { foo: 'bar' } })
    expect(parseKeyContext('baz foo=bar')).toEqual(expected)
    expect(parseKeyContext('baz foo = bar')).toEqual(expected)
    expect(parseKeyContext('  baz foo   =   bar baz')).toEqual(expected)
    expect(parseKeyContext(' baz foo = bar')).toEqual(expected)
  })
})

describe('parseContextPredicate', () => {
  it('parses identifiers', () => {
    expect(parseContextPredicate('abc12')).toEqual(id('abc12'))
    expect(parseContextPredicate('_1a')).toEqual(id('_1a'))
  })

  it('parses negations', () => {
    expect(parseContextPredicate('!abc')).toEqual(not(id('abc')))
    expect(parseContextPredicate(' ! ! abc')).toEqual(not(not(id('abc'))))
  })

  it('parses equality operators', () => {
    expect(parseContextPredicate('a == b')).toEqual(eq('a', 'b'))
    expect(parseContextPredicate('c!=d')).toEqual(neq('c', 'd'))
    expect(() => parseContextPredicate('c == !d')).toThrow(
      'Operands of == and != must be identifiers',
    )
  })

  it('parses boolean operators with && binding tighter than ||', () => {
    expect(parseContextPredicate('a || b')).toEqual(or(id('a'), id('b')))
    expect(parseContextPredicate('a || !b && c')).toEqual(or(id('a'), and(not(id('b')), id('c'))))
    expect(parseContextPredicate('a && b || c&&d')).toEqual(
      or(and(id('a'), id('b')), and(id('c'), id('d'))),
    )
    expect(parseContextPredicate('a == b && c || d == e && f')).toEqual(
      or(and(eq('a', 'b'), id('c')), and(eq('d', 'e'), id('f'))),
    )
    expect(parseContextPredicate('a && b && c && d')).toEqual(
      and(and(and(id('a'), id('b')), id('c')), id('d')),
    )
  })

  it('parses parenthesized expressions', () => {
    expect(parseContextPredicate('a && (b == c || d != e)')).toEqual(
      and(id('a'), or(eq('b', 'c'), neq('d', 'e'))),
    )
    expect(parseContextPredicate(' ( a || b ) ')).toEqual(or(id('a'), id('b')))
  })

  it('rejects trailing and unexpected input', () => {
    expect(() => parseContextPredicate('a b')).toThrow(SyntaxError)
    expect(() => parseContextPredicate('(a')).toThrow(SyntaxError)
    expect(() => parseContextPredicate('')).toThrow(SyntaxError)
  })
})

describe('evaluatePredicate', () => {
  it('matches > against any ancestor of the innermost context', () => {
    expect(evaluate('parent > child', ['parent', 'child'])).toBe(true)
    expect(evaluate('parent > child', ['grandparent', 'parent', 'child'])).toBe(true)
    expect(evaluate('parent > child', ['other', 'child'])).toBe(false)
    expect(evaluate('parent > child', ['parent', 'other', 'child'])).toBe(true)
    expect(evaluate('parent > child', [])).toBe(false)
    expect(evaluate('parent > child', ['child'])).toBe(false)
    expect(evaluate('parent > child', ['parent'])).toBe(false)
    expect(evaluate('child > child', ['child'])).toBe(false)
    expect(evaluate('child > child', ['child', 'child'])).toBe(true)
  })

  it('negates across the whole stack', () => {
    expect(evaluate('!editor', ['workspace'])).toBe(true)
    expect(evaluate('!editor', ['editor'])).toBe(false)
    expect(evaluate('!editor', ['editor', 'workspace'])).toBe(false)
    expect(evaluate('!editor', ['workspace', 'editor'])).toBe(false)
    expect(evaluate('!editor && workspace', ['workspace'])).toBe(true)
    expect(evaluate('!editor && workspace', ['editor', 'workspace'])).toBe(false)
    expect(evaluate('!(mode == full)', ['mode=full'])).toBe(false)
    expect(evaluate('!(mode == full)', ['mode=partial'])).toBe(true)
    expect(evaluate('!(parent > child)', ['parent'])).toBe(true)
    expect(evaluate('!(parent > child)', ['child'])).toBe(true)
    expect(evaluate('!(parent > child)', ['parent', 'child'])).toBe(false)
    expect(evaluate('parent > !child', ['parent'])).toBe(false)
    expect(evaluate('parent > !child', ['child'])).toBe(false)
    expect(evaluate('parent > !child', ['parent', 'child'])).toBe(false)
    expect(evaluate('!!editor', ['editor'])).toBe(true)
    expect(evaluate('!!editor', ['workspace'])).toBe(false)
  })

  it('evaluates chained descendants left to right', () => {
    const stack = ['Workspace', 'Pane', 'Editor']
    expect(evaluate('Pane > (Pane > Editor)', stack)).toBe(false)
    expect(evaluate('Workspace > Pane > Editor', stack)).toBe(true)
    expect(evaluate('(Pane > Pane) > Editor', stack)).toBe(false)
    expect(evaluate('Pane > !Workspace', ['Pane', 'Editor'])).toBe(true)
    expect(evaluate('Pane > !Workspace', ['Pane', 'Workspace'])).toBe(false)
    expect(evaluate('!Workspace', ['Workspace'])).toBe(false)
    expect(evaluate('!Workspace', ['Pane'])).toBe(true)
    expect(evaluate('!Workspace', stack)).toBe(false)
  })

  it('treats != as true when the key is absent', () => {
    expect(evaluate('extension != md', ['Editor'])).toBe(true)
    expect(evaluate('extension != md', ['Editor extension=md'])).toBe(false)
  })
})

describe('predicateDepth', () => {
  // Zed test_keymap: global bindings match at the full depth, contextual ones where they match.
  it('reports the deepest matching depth', () => {
    expect(predicateDepth(undefined, [])).toBe(0)
    expect(predicateDepth(undefined, [ctx('terminal')])).toBe(1)
    expect(predicateDepth(parseContextPredicate('pane'), [ctx('barf x=y')])).toBeNull()
    expect(predicateDepth(parseContextPredicate('pane'), [ctx('pane x=y')])).toBe(1)
    const editorFull = parseContextPredicate('editor && mode==full')
    expect(predicateDepth(editorFull, [ctx('editor')])).toBeNull()
    expect(predicateDepth(editorFull, [ctx('editor mode=full')])).toBe(1)
    expect(
      predicateDepth(parseContextPredicate('Workspace'), [ctx('Workspace'), ctx('Editor')]),
    ).toBe(1)
  })
})
