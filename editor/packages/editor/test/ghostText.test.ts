import { describe, expect, it } from 'vitest'

import { createStringTextSnapshot as source } from '../src/documentTextSnapshot'
import { computeGhostText, ghostTextDiff, ghostTextInlineSpecs } from '../src/editor/ghostText'

/**
 * A suggestion arrives as an ordinary replacement over a range, and what can be *drawn* from it is a
 * much smaller thing: the characters the document does not already hold, at the offsets they would be
 * typed at. Everything here is about that reduction, because the reduction is what decides whether
 * accepting produces the text the reader was looking at.
 */

describe('deriving ghost text from a text edit', () => {
  it('offers only the characters the document does not already hold', () => {
    const ghost = computeGhostText(source('console.'), { from: 0, to: 8, text: 'console.log()' }, 8)

    expect(ghost?.parts).toEqual([{ offset: 8, text: 'log()' }])
    // Accepting writes the remainder, not the whole line again: replacing text with itself would
    // move every anchor, decoration and fold inside it for nothing.
    expect(ghost?.edit).toEqual({ from: 8, to: 8, text: 'log()' })
  })

  it('refuses a suggestion that would take characters away', () => {
    expect(computeGhostText(source('foo bar'), { from: 0, to: 7, text: 'foo baz' }, 7)).toBeNull()
  })

  it('refuses to draw anything behind the caret', () => {
    const suggestion = { from: 0, to: 3, text: 'xfoo' }

    expect(computeGhostText(source('foo'), suggestion, 3)).toBeNull()
    expect(computeGhostText(source('foo'), suggestion, 0)?.parts).toEqual([
      { offset: 0, text: 'x' },
    ])
  })

  it('refuses a replacement still covering rows once its common prefix is off', () => {
    expect(computeGhostText(source('a\nb'), { from: 0, to: 3, text: 'ax\nby' }, 0)).toBeNull()
    // The rows it covers reading exactly as the suggestion does is what makes the rest of it a
    // completion of one line rather than a rewrite of several.
    expect(computeGhostText(source('a\nb'), { from: 0, to: 3, text: 'a\nbc' }, 3)?.parts).toEqual([
      { offset: 3, text: 'c' },
    ])
  })

  it('refuses a run that would not fit in the row it hangs off', () => {
    expect(computeGhostText(source('ab'), { from: 0, to: 2, text: 'a\nb' }, 1)).toBeNull()
  })

  it('re-bases a suggestion that reaches back into the indentation in front of it', () => {
    const ghost = computeGhostText(source('    foo'), { from: 0, to: 7, text: '\tfoobar' }, 7)

    // Aligned against the whole line the tab would have to replace four spaces, which is a deletion
    // and the end of the ghost text; from past the indentation the same suggestion simply adds.
    expect(ghost?.parts).toEqual([{ offset: 7, text: 'bar' }])
    expect(ghost?.edit).toEqual({ from: 4, to: 7, text: 'foobar' })
  })

  it('aligns brackets by depth rather than by the first one it meets', () => {
    const ghost = computeGhostText(
      source('if ()'),
      { from: 0, to: 5, text: '  if (f() = 1) { g(); }' },
      0,
    )

    expect(ghost?.parts).toEqual([
      { offset: 0, text: '  ' },
      { offset: 4, text: 'f() = 1' },
      { offset: 5, text: ' { g(); }' },
    ])
  })

  it('takes the alignment that deletes least when bracket depth is the thing in the way', () => {
    // The two parentheses open different groups, so depth alone calls them different characters and
    // the alignment pays for a deletion it does not need.
    expect(ghostTextDiff('(', ')(')).toEqual([
      { originalStart: 0, originalLength: 0, modifiedStart: 0, modifiedLength: 1 },
    ])
    expect(computeGhostText(source('('), { from: 0, to: 1, text: ')(' }, 0)?.parts).toEqual([
      { offset: 0, text: ')' },
    ])
  })

  it('answers the pair it was just asked about from what it worked out then', () => {
    expect(ghostTextDiff('con', 'const')).toBe(ghostTextDiff('con', 'const'))
  })

  // The regions are the whole of what stands between a suggestion and text nobody asked for, and the
  // walk back through the alignment is the part of it with no shape a reader would recognize as
  // wrong. Rebuilding the suggestion from them is the one statement that covers every pair.
  it('hands back regions that rebuild the suggestion, for pair after pair', () => {
    const random = seededRandom(0x5eed)

    for (let round = 0; round < 400; round += 1) {
      const original = randomFragment(random)
      const modified = randomFragment(random)
      const changes = ghostTextDiff(original, modified)

      expect(changes).not.toBeNull()
      expect(rebuild(original, modified, changes ?? [])).toBe(modified)
    }
  })

  // Everything on a run is something the paint reads back, the class included: the row painter boxes
  // a classed run into its own element, which is the only reason text nobody typed can be told apart
  // from text they did.
  it('hangs every run off a point of its own, styled as text nobody has typed', () => {
    const ghost = computeGhostText(source('con'), { from: 0, to: 3, text: 'const answer' }, 3)
    const specs = ghostTextInlineSpecs(ghost!)

    expect(specs).toEqual([
      {
        id: 'ghost-text:0',
        startIndex: 3,
        endIndex: 3,
        text: 'st answer',
        insertion: true,
        kind: 'ghost-text',
        className: 'editor-ghost-text',
        cursorStops: 'left',
      },
    ])
  })
})

/** A repeatable sequence, so a pair that ever fails fails again on the next run. */
function seededRandom(seed: number): () => number {
  let state = seed

  // Multiplied by a factor small enough that the product stays exact, so the sequence is the same
  // number for number on every machine that runs it.
  return () => {
    state = (state * 48271) % 2147483647
    return state / 2147483647
  }
}

function randomFragment(random: () => number): string {
  const alphabet = 'ab()cd '
  const length = Math.floor(random() * 12)
  let text = ''
  for (let index = 0; index < length; index += 1) {
    text += alphabet[Math.floor(random() * alphabet.length)]
  }

  return text
}

/** Writes the regions back over the original; a correct alignment reproduces the suggestion. */
function rebuild(
  original: string,
  modified: string,
  changes: readonly {
    readonly originalStart: number
    readonly originalLength: number
    readonly modifiedStart: number
    readonly modifiedLength: number
  }[],
): string {
  let text = ''
  let cursor = 0
  for (const change of changes) {
    text += original.slice(cursor, change.originalStart)
    text += modified.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength)
    cursor = change.originalStart + change.originalLength
  }

  return text + original.slice(cursor)
}
