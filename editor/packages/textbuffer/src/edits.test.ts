import { describe, expect, test } from 'vitest'
import {
  anchorAt,
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  debugPieceTable,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  resolveAnchor,
  resolveAnchorLinear,
  snapBatchEditRanges,
} from './index'
import { validatePieceTreeInvariants } from './inspection'
import type { PieceTableEdit, PieceTableSnapshot } from './pieceTableTypes'

const HIGH = '\ud83d'
const LOW = '\ude00'

const applyToString = (text: string, edit: PieceTableEdit): string =>
  text.slice(0, edit.from) + edit.text + text.slice(edit.to)

// The batch pipeline is the reference: whatever it would apply for one edit,
// the single-edit path must apply too, or a snapped range differs by caller.
const expectSingleEditMatchesBatch = (snapshot: PieceTableSnapshot, edit: PieceTableEdit): void => {
  const text = materializePieceTableFullText(snapshot)
  const [reference] = snapBatchEditRanges(snapshot, [edit])
  const expected = applyToString(text, reference!)
  const label = `${JSON.stringify(edit)} on ${JSON.stringify(text)}`

  const applied = applyBatchToPieceTable(snapshot, [edit])
  expect(materializePieceTableFullText(applied), label).toBe(expected)
  expect(validatePieceTreeInvariants(applied).issues, label).toEqual([])
  // Same pieces hidden and the text in the same place, so anchors agree too.
  const snapped = applyBatchToPieceTable(snapshot, snapBatchEditRanges(snapshot, [edit]))
  for (let offset = 0; offset <= text.length; offset++) {
    for (const bias of ['left', 'right'] as const) {
      const anchor = anchorAt(snapshot, offset, bias)
      expect(resolveAnchor(applied, anchor), label).toEqual(resolveAnchor(snapped, anchor))
    }
  }
  if (edit.from === edit.to) {
    expect(
      materializePieceTableFullText(insertIntoPieceTable(snapshot, edit.from, edit.text)),
      label,
    ).toBe(expected)
  }
  if (edit.text === '') {
    expect(
      materializePieceTableFullText(deleteFromPieceTable(snapshot, edit.from, edit.to - edit.from)),
      label,
    ).toBe(expected)
  }
}

describe('single-edit path', () => {
  test('snaps a caret inside a pair leftwards like the batch path', () => {
    const snapshot = createPieceTableSnapshot(`a${HIGH}${LOW}b`)
    expectSingleEditMatchesBatch(snapshot, { from: 2, to: 2, text: 'x' })
    expect(materializePieceTableFullText(insertIntoPieceTable(snapshot, 2, 'x'))).toBe(
      `ax${HIGH}${LOW}b`,
    )
  })

  test('widens a range that would orphan a half like the batch path', () => {
    const snapshot = createPieceTableSnapshot(`a${HIGH}${LOW}b`)
    expectSingleEditMatchesBatch(snapshot, { from: 2, to: 3, text: '' })
    expect(materializePieceTableFullText(deleteFromPieceTable(snapshot, 2, 1))).toBe('ab')
    expectSingleEditMatchesBatch(snapshot, { from: 1, to: 2, text: '' })
  })

  test('keeps a whole-code-point replacement of one half as given', () => {
    const snapshot = createPieceTableSnapshot(`a${HIGH}${LOW}b`)
    expectSingleEditMatchesBatch(snapshot, { from: 2, to: 3, text: '\ude01' })
    expectSingleEditMatchesBatch(snapshot, { from: 1, to: 2, text: '\ud83e' })
  })

  test('rejects the same invalid ranges as the batch path', () => {
    const snapshot = createPieceTableSnapshot('abc')
    expect(() => insertIntoPieceTable(snapshot, 4, 'x')).toThrow(RangeError)
    expect(() => deleteFromPieceTable(snapshot, 2, 5)).toThrow(RangeError)
    expect(() => applyBatchToPieceTable(snapshot, [{ from: 2, to: 1, text: '' }])).toThrow(
      RangeError,
    )
  })

  // Pairs whose halves sit in two pieces, one with a tombstone between them.
  const straddledPairs = (transient: boolean): PieceTableSnapshot => {
    let snapshot = createPieceTableSnapshot(`${HIGH}${LOW}ab\ncd${HIGH}${LOW}`, { transient })
    snapshot = insertIntoPieceTable(snapshot, 3, HIGH)
    snapshot = insertIntoPieceTable(snapshot, 0, 'x')
    snapshot = insertIntoPieceTable(snapshot, 5, `${LOW}--${HIGH}`)
    snapshot = insertIntoPieceTable(snapshot, 0, 'y')
    snapshot = insertIntoPieceTable(snapshot, 10, `?${LOW}`)
    return deleteFromPieceTable(snapshot, 10, 1)
  }

  test('checks a range inside the hide exactly as the batch path snaps it', () => {
    const snapshot = straddledPairs(false)
    const text = materializePieceTableFullText(snapshot)
    expect(text).toBe(`yx${HIGH}${LOW}a${HIGH}${LOW}--${HIGH}${LOW}b\ncd${HIGH}${LOW}`)
    const texts = ['', 'x', LOW, HIGH, `${LOW}${HIGH}`, `${HIGH}${LOW}`]
    for (let from = 0; from < text.length; from++) {
      for (let to = from + 1; to <= text.length; to++) {
        for (const inserted of texts) {
          expectSingleEditMatchesBatch(snapshot, { from, to, text: inserted })
        }
      }
    }
  })

  test('a range that has to run again leaves an in-place tree as it found it', () => {
    const text = materializePieceTableFullText(straddledPairs(true))
    for (let from = 0; from < text.length; from++) {
      for (let to = from + 1; to <= text.length; to++) {
        const edit = { from, to, text: 'new' }
        const [reference] = snapBatchEditRanges(straddledPairs(true), [edit])
        const applied = applyBatchToPieceTable(straddledPairs(true), [edit])
        const label = JSON.stringify(edit)
        expect(materializePieceTableFullText(applied), label).toBe(applyToString(text, reference!))
        expect(validatePieceTreeInvariants(applied).issues, label).toEqual([])
      }
    }
  })

  test('skips every check until the lineage holds a surrogate, and never forgets one', () => {
    const plain = createPieceTableSnapshot('plain ascii')
    expect(plain.buffers.containsSurrogates).toBe(false)
    expect(createPieceTableSnapshot('a😀').buffers.containsSurrogates).toBe(true)
    expect(createPieceTableSnapshot(`a${LOW}`, { normalized: true }).buffers).toMatchObject({
      containsSurrogates: true,
    })
    const forced = createPieceTableSnapshot('plain ascii', { containsSurrogates: true })
    expect(forced.buffers.containsSurrogates).toBe(true)

    const typed = insertIntoPieceTable(insertIntoPieceTable(plain, 5, 'x'), 6, 'y')
    expect(typed.buffers.containsSurrogates).toBe(false)
    const gained = insertIntoPieceTable(typed, 7, '😀')
    expect(gained.buffers.containsSurrogates).toBe(true)
    const lost = deleteFromPieceTable(gained, 7, 2)
    expect(materializePieceTableFullText(lost)).toBe('plainxy ascii')
    expect(lost.buffers.containsSurrogates).toBe(true)

    // Undo hands back the snapshot that holds the pair, and its flag with it.
    expect(materializePieceTableFullText(deleteFromPieceTable(gained, 8, 1))).toBe('plainxy ascii')
    expect(materializePieceTableFullText(insertIntoPieceTable(gained, 8, '!'))).toBe(
      'plainxy!😀 ascii',
    )
    // The older snapshot never held one, and is still edited without a check.
    expect(typed.buffers.containsSurrogates).toBe(false)
    expect(materializePieceTableFullText(deleteFromPieceTable(typed, 0, 5))).toBe('xy ascii')
  })

  test('matches the batch path across fuzzed edits of a surrogate-rich document', () => {
    let state = 7
    const random = (limit: number): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state % limit
    }
    const texts = ['', 'x', '😀', LOW, HIGH, `${LOW}${HIGH}`, 'ab\n', `${HIGH}${LOW}${HIGH}${LOW}`]
    let snapshot = createPieceTableSnapshot('😀ab😀\n'.repeat(6))
    for (let step = 0; step < 300; step++) {
      const length = snapshot.length
      const from = random(length + 1)
      const to = random(2) === 0 ? from : Math.min(length, from + random(5))
      const edit = { from, to, text: texts[random(texts.length)]! }
      expectSingleEditMatchesBatch(snapshot, edit)
      snapshot = applyBatchToPieceTable(snapshot, [edit])
    }
  })
})

const createRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

describe('one pass per edit call', () => {
  // The fused replace places its text during the hide descent. The text must
  // match delete-then-insert and the index must agree with the linear walk.
  // Anchors are not compared across the two: each branch numbers its buffers.
  test('a fused replacement matches delete then insert', () => {
    const random = createRandom(45)
    const pick = (max: number) => Math.floor(random() * max)
    let fused = createPieceTableSnapshot('one two\nthree four\nfive six seven\n'.repeat(12))
    let stepped = fused
    const anchors = []

    for (let edit = 0; edit < 400; edit += 1) {
      const length = fused.length
      if (anchors.length < 60)
        anchors.push(anchorAt(fused, pick(length + 1), edit % 2 ? 'left' : 'right'))
      const from = pick(length)
      const to = Math.min(length, from + 1 + pick(edit % 9 === 0 ? 40 : 6))
      const text = `${edit % 7}\n`.slice(0, 1 + pick(2))
      fused = applyBatchToPieceTable(fused, [{ from, to, text }])
      stepped = insertIntoPieceTable(deleteFromPieceTable(stepped, from, to - from), from, text)

      expect(materializePieceTableFullText(fused)).toBe(materializePieceTableFullText(stepped))
      for (const anchor of anchors) {
        expect(resolveAnchor(fused, anchor)).toEqual(resolveAnchorLinear(fused, anchor))
      }
    }
    expect(validatePieceTreeInvariants(fused).issues).toEqual([])
  })

  // The text goes between tombstones already at the offset and the range
  // being hidden, so bias decides every deleted anchor on both sides of it.
  test('a replacement keeps deleted anchors on their biased side of the new text', () => {
    const initial = createPieceTableSnapshot('abcdefgh')
    const earlier = [anchorAt(initial, 3, 'left'), anchorAt(initial, 3, 'right')]
    const later = [anchorAt(initial, 5, 'left'), anchorAt(initial, 5, 'right')]
    const once = applyBatchToPieceTable(initial, [{ from: 2, to: 4, text: '' }])
    const replaced = applyBatchToPieceTable(once, [{ from: 2, to: 4, text: 'XY' }])

    expect(materializePieceTableFullText(replaced)).toBe('abXYgh')
    for (const anchors of [earlier, later]) {
      expect(resolveAnchor(replaced, anchors[0]!)).toEqual({ offset: 2, liveness: 'deleted' })
      expect(resolveAnchor(replaced, anchors[1]!)).toEqual({ offset: 4, liveness: 'deleted' })
    }
  })

  test('new text lands right before the first unit it replaces, whatever the tree shape', () => {
    // Tombstones throughout, so some range covers a whole subtree that begins
    // with one. Text placed ahead of that tombstone would sit on the wrong
    // side of every anchor deleted with it.
    const original = 'abcdefghijklmnopqrstuvwxyz'.repeat(3)
    for (const seed of [1, 2, 3]) {
      const random = createRandom(seed)
      let snapshot = createPieceTableSnapshot(original)
      for (let step = 0; step < 24; step++) {
        snapshot = deleteFromPieceTable(snapshot, Math.floor(random() * (snapshot.length - 1)), 1)
      }
      const text = materializePieceTableFullText(snapshot)
      const origins: number[] = []
      for (const piece of debugPieceTable(snapshot)) {
        for (let unit = 0; piece.visible && unit < piece.length; unit++)
          origins.push(piece.start + unit)
      }
      for (let from = 0; from < text.length; from++) {
        for (let to = from + 1; to <= text.length; to++) {
          const replaced = applyBatchToPieceTable(snapshot, [{ from, to, text: 'NEW' }])
          const pieces = debugPieceTable(replaced)
          const after = pieces[pieces.findIndex((piece) => piece.buffer !== 0) + 1]!
          expect([after.visible, after.start], `seed ${seed} [${from}, ${to})`).toEqual([
            false,
            origins[from],
          ])
        }
      }
    }
  })

  test('a multi-cursor batch leaves a valid index and the same text as its edits in turn', () => {
    const snapshot = createPieceTableSnapshot('alpha beta gamma delta epsilon zeta eta theta')
    const edits = [
      { from: 0, to: 5, text: 'A' },
      { from: 6, to: 6, text: 'in' },
      { from: 11, to: 16, text: '' },
      { from: 40, to: 45, text: 'THETA\n' },
    ]
    const batched = applyBatchToPieceTable(snapshot, edits)

    expect(materializePieceTableFullText(batched)).toBe(
      edits.toReversed().reduce(applyToString, materializePieceTableFullText(snapshot)),
    )
    expect(validatePieceTreeInvariants(batched).issues).toEqual([])
    expect(materializePieceTableFullText(snapshot)).toContain('alpha beta')
  })

  // The editor maps selections through a batch by this order.
  test('edits at one offset apply in the order given, the later one in front', () => {
    const snapshot = createPieceTableSnapshot('ab')
    const edits = [
      { from: 1, to: 1, text: 'X' },
      { from: 1, to: 1, text: 'Y' },
    ]
    expect(materializePieceTableFullText(applyBatchToPieceTable(snapshot, edits))).toBe('aYXb')
  })

  // Trusting a snapped array against the wrong snapshot would skip a snap
  // that document needs.
  test('reuses ranges snapped against this snapshot and re-snaps any other', () => {
    const plain = createPieceTableSnapshot(`ab${HIGH}${LOW}cd`)
    const shifted = createPieceTableSnapshot(`a${HIGH}${LOW}bcd`)
    const snapped = snapBatchEditRanges(plain, [{ from: 2, to: 2, text: 'x' }])

    expect(materializePieceTableFullText(applyBatchToPieceTable(plain, snapped))).toBe(
      `abx${HIGH}${LOW}cd`,
    )
    expect(materializePieceTableFullText(applyBatchToPieceTable(shifted, snapped))).toBe(
      `ax${HIGH}${LOW}bcd`,
    )
  })
})
