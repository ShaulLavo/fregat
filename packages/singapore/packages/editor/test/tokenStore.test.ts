import { describe, expect, it } from 'vitest'
import { projectTokensThroughEdit } from '../src/editor/tokenProjection'
import { packEditorTokens } from '../src/syntax/packedTokens'
import { EditorTokenStore, toEditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorToken, TextEdit } from '../src/tokens'

const keyword = { color: '#f00' }
const name = { color: '#0f0' }

// "const a = 1;\nconst b = 2;" tokenized as keyword, name per line.
const twoLines = (): EditorTokenStore =>
  EditorTokenStore.fromTokens([
    { start: 0, end: 5, style: keyword },
    { start: 6, end: 7, style: name },
    { start: 13, end: 18, style: keyword },
    { start: 19, end: 20, style: name },
  ])

describe('EditorTokenStore reads', () => {
  // The failure is an off-by-one at a row boundary: a row painted with its neighbour's token.
  it('finds a row slice at both ends of the document', () => {
    const tokens = twoLines()

    expect(tokens.firstStartingAtOrAfter(0)).toBe(0)
    expect(tokens.firstStartingAtOrAfter(13)).toBe(2)
    expect(tokens.firstStartingAtOrAfter(21)).toBe(4)
    expect(tokens.firstStartingAfter(13)).toBe(3)
    expect(tokens.firstEndingAfter(0)).toBe(0)
    expect(tokens.firstEndingAfter(5)).toBe(1)
    expect(tokens.firstEndingAtOrAfter(5)).toBe(0)
    expect(tokens.firstEndingAfter(20)).toBe(4)

    const last = tokens.firstStartingAtOrAfter(12)
    expect(tokens.toTokens(tokens.firstEndingAfter(0, last), last)).toEqual([
      { start: 0, end: 5, style: keyword },
      { start: 6, end: 7, style: name },
    ])
    expect(tokens.toTokens(4)).toEqual([])
    expect(EditorTokenStore.empty().firstEndingAfter(0)).toBe(0)
  })

  it('sorts hand-built input once, keeping the order of equal starts', () => {
    const first = { color: 'a' }
    const second = { color: 'b' }
    const tokens = toEditorTokenStore([
      { start: 4, end: 6, style: first },
      { start: 0, end: 2, style: first },
      { start: 0, end: 3, style: second },
    ])

    expect(tokens.toTokens()).toEqual([
      { start: 0, end: 2, style: first },
      { start: 0, end: 3, style: second },
      { start: 4, end: 6, style: first },
    ])
    expect(toEditorTokenStore(tokens)).toBe(tokens)
  })

  it('rejects a style id with no style in the palette', () => {
    const packed = packEditorTokens([{ start: 0, end: 1, style: keyword }])

    expect(() => EditorTokenStore.fromPacked({ ...packed, styles: [] })).toThrow(/names style 0/)
    expect(() => twoLines().tokenAt(4)).toThrow(/outside a store of 4/)
  })
})

describe('EditorTokenStore patches', () => {
  it('replaces the tokens of the edited lines and shifts the rest', () => {
    // Line 0 becomes "const answer = 1;", 5 characters longer.
    const base = twoLines()
    const spliced = base.applyPatch({
      fromOffset: 0,
      oldEndOffset: 13,
      newEndOffset: 18,
      tokensPacked: packEditorTokens([
        { start: 0, end: 5, style: { color: '#f00' } },
        { start: 6, end: 12, style: { color: '#00f' } },
      ]),
    })

    expect(spliced.toTokens()).toEqual([
      { start: 0, end: 5, style: keyword },
      { start: 6, end: 12, style: { color: '#00f' } },
      { start: 18, end: 23, style: keyword },
      { start: 24, end: 25, style: name },
    ])
    // The equal-by-value keyword style reused its id; the new one joined the palette.
    expect(spliced.styles).toEqual([keyword, name, { color: '#00f' }])
    expect(Array.from(spliced.toPacked().styleIds)).toEqual([0, 2, 0, 1])
    expect(spliced).toMatchObject({ nonOverlapping: true, monotonicEnd: true })
    // A fresh answer makes no claim about the store the view is showing.
    expect(spliced.derivedFrom).toBeNull()
    expect(base.toTokens()).toHaveLength(4)
  })

  it('keeps the palette identity when a patch brings no new style', () => {
    const base = twoLines()
    const spliced = base.applyPatch({
      fromOffset: 13,
      oldEndOffset: 20,
      newEndOffset: 22,
      tokensPacked: packEditorTokens([{ start: 13, end: 22, style: { color: '#0f0' } }]),
    })

    expect(spliced.styles).toBe(base.styles)
    expect(spliced.toTokens().map((token) => [token.start, token.end])).toEqual([
      [0, 5],
      [6, 7],
      [13, 22],
    ])
  })

  it('drops a deleted line and pulls later tokens back', () => {
    const spliced = twoLines().applyPatch({
      fromOffset: 0,
      oldEndOffset: 13,
      newEndOffset: 0,
      tokensPacked: packEditorTokens([]),
    })

    expect(spliced.toTokens()).toEqual([
      { start: 0, end: 5, style: keyword },
      { start: 6, end: 7, style: name },
    ])
  })

  // The failure is a range answer leaving half of a token that reached into its window.
  it('replaces every token reaching into an offset range', () => {
    const merged = twoLines().replaceOffsetRange(
      6,
      14,
      EditorTokenStore.fromTokens([{ start: 8, end: 9, style: name }]),
    )

    expect(merged.toTokens()).toEqual([
      { start: 0, end: 5, style: keyword },
      { start: 8, end: 9, style: name },
      { start: 19, end: 20, style: name },
    ])
  })
})

describe('EditorTokenStore provenance and comparison', () => {
  // The failure is a lost fast path: the view cannot tell a projection of its own store.
  it('names the store a projection came from, and nothing for a fresh answer', () => {
    const base = twoLines()
    const projected = projectTokensThroughEdit(base, { from: 7, to: 7, text: 'b' }, 'const a = 1;')

    expect(projected.derivedFrom).toEqual({ revision: base.revision, keepsLiveRanges: true })
    expect(projected.revision).not.toBe(base.revision)
    expect(twoLines().revision).not.toBe(base.revision)
  })

  // The failure is a minimap patch the size of the document for an edit to one line.
  it('finds the changed range between a projection and the answer that replaces it', () => {
    const style = { color: '#123' }
    const base = EditorTokenStore.fromTokens(
      Array.from({ length: 1_000 }, (_, index) => ({
        start: index * 4,
        end: index * 4 + 3,
        style,
      })),
    )
    const projected = projectTokensThroughEdit(base, { from: 2001, to: 2001, text: 'x' }, '')
    const answered = base.applyPatch({
      fromOffset: 2000,
      oldEndOffset: 2004,
      newEndOffset: 2005,
      tokensPacked: packEditorTokens([
        { start: 2000, end: 2002, style },
        { start: 2002, end: 2004, style },
      ]),
    })

    expect(projected.changedRangeTo(answered)).toEqual({
      start: 500,
      deleteCount: 1,
      insertEnd: 502,
    })
    expect(projected.changedRangeTo(projected)).toEqual({
      start: 1_000,
      deleteCount: 0,
      insertEnd: 1_000,
    })
    expect(projected.equals(answered)).toBe(false)
    expect(base.equals(twoLines())).toBe(false)
    expect(twoLines().equals(twoLines())).toBe(true)
    expect(twoLines().stylesEqual(projectTokensThroughEdit(twoLines(), EDIT_IN_NAME, ''))).toBe(
      true,
    )
  })
})

const EDIT_IN_NAME: TextEdit = { from: 7, to: 7, text: 'b' }

describe('EditorTokenStore under many edits', () => {
  // The failure is a segment boundary bug: a shift applied twice, or to the wrong side of an edit.
  it('matches a plain array model through a long run of edits at scattered places', () => {
    const style = { color: '#123' }
    let model: EditorToken[] = Array.from({ length: 400 }, (_, index) => ({
      start: index * 6,
      end: index * 6 + 4,
      style,
    }))
    let tokens = EditorTokenStore.fromTokens(model)
    let length = 400 * 6
    let seed = 7

    for (let step = 0; step < 600; step += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      const from = seed % length
      const edit: TextEdit =
        step % 3 === 0
          ? { from, to: Math.min(length, from + 1 + (seed % 9)), text: '' }
          : { from, to: from, text: ' '.repeat(1 + (seed % 3)) }

      model = projectModel(model, edit)
      tokens = projectTokensThroughEdit(tokens, edit, '')
      length += edit.text.length - (edit.to - edit.from)
    }

    expect(tokens.toTokens()).toEqual(model)
    expect(tokens.equals(EditorTokenStore.fromTokens(model))).toBe(true)
    expect(tokens).toMatchObject({ monotonicEnd: true, nonOverlapping: true })
  })
})

// Same-line rules for text that is not word-like: grow around an insertion, shrink around a
// deletion, shift after either, and drop what a deletion only partly covers.
function projectModel(model: readonly EditorToken[], edit: TextEdit): EditorToken[] {
  const delta = edit.text.length - (edit.to - edit.from)
  const projected: EditorToken[] = []
  for (const token of model) {
    const next = projectModelToken(token, edit, delta)
    if (next && next.end > next.start) projected.push(next)
  }
  return projected
}

function projectModelToken(token: EditorToken, edit: TextEdit, delta: number): EditorToken | null {
  const insertion = edit.from === edit.to
  if (insertion && token.start < edit.from && edit.from < token.end) {
    return { ...token, end: token.end + delta }
  }
  if (insertion && token.start >= edit.from) return shiftModelToken(token, delta)
  if (insertion || token.end <= edit.from) return token
  if (token.start >= edit.to) return shiftModelToken(token, delta)
  if (token.start < edit.from && edit.to < token.end) return { ...token, end: token.end + delta }
  return null
}

function shiftModelToken(token: EditorToken, delta: number): EditorToken {
  return { ...token, start: token.start + delta, end: token.end + delta }
}
