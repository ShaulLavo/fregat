import { describe, expect, test } from 'vitest'
import type { PieceTableEdit, PieceTableSnapshot, PieceTreeNode } from './pieceTableTypes'
import {
  anchorAt,
  applyBatchToPieceTable,
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  offsetToPoint,
  resolveAnchor,
  resolveAnchorLinear,
} from './pieceTable'
import { validatePieceTreeInvariants } from './inspection'

type Random = () => number

const createRandom = (seed: number): Random => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const pick = (random: Random, maxExclusive: number): number => Math.floor(random() * maxExclusive)

const ALPHABET = ['a', 'b', 'c', '\n', ' ', 'é', '\n']

const randomText = (random: Random, maxLength: number): string => {
  let text = ''
  const length = 1 + pick(random, maxLength)
  for (let index = 0; index < length; index += 1) text += ALPHABET[pick(random, ALPHABET.length)]
  return text
}

const documentOf = (lines: number): string =>
  Array.from({ length: lines }, (_, row) => `line ${row} of the fixture`).join('\n')

const heightOf = (node: PieceTreeNode | null): number =>
  node ? 1 + Math.max(heightOf(node.left), heightOf(node.right)) : 0

// AVL's worst case; a weight-balanced tree with alpha 0.29 is bounded by 2.03.
const expectHeightBound = (snapshot: PieceTableSnapshot) => {
  const bound = 2.03 * Math.log2(snapshot.pieceCount + 2)
  expect(heightOf(snapshot.root)).toBeLessThanOrEqual(Math.ceil(bound))
}

const pointOf = (text: string, offset: number) => {
  const before = text.slice(0, offset)
  const row = before.split('\n').length - 1
  return { row, column: offset - (before.lastIndexOf('\n') + 1) }
}

const expectMatchesModel = (snapshot: PieceTableSnapshot, text: string, random: Random) => {
  expect(materializePieceTableFullText(snapshot)).toBe(text)
  expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
  expectHeightBound(snapshot)
  for (let sample = 0; sample < 4; sample += 1) {
    const offset = pick(random, text.length + 1)
    expect(offsetToPoint(snapshot, offset)).toEqual(pointOf(text, offset))
  }
}

const spliceText = (text: string, edit: PieceTableEdit): string =>
  text.slice(0, edit.from) + edit.text + text.slice(edit.to)

const randomBatch = (random: Random, length: number): PieceTableEdit[] => {
  const edits: PieceTableEdit[] = []
  let cursor = 0
  for (let index = 0; index < 4 && cursor < length; index += 1) {
    const from = cursor + pick(random, Math.max(1, (length - cursor) >> 1))
    const to = Math.min(length, from + pick(random, 6))
    edits.push({ from, to, text: random() < 0.7 ? randomText(random, 5) : '' })
    cursor = to + 1
  }
  return edits
}

type State = { snapshot: PieceTableSnapshot; text: string }

const stepRandom = (state: State, random: Random): State => {
  const { snapshot, text } = state
  const roll = random()
  if (roll < 0.1 && text.length > 8) {
    const edits = randomBatch(random, text.length)
    const applied = edits.toSorted((a, b) => b.from - a.from).reduce(spliceText, text)
    return { snapshot: applyBatchToPieceTable(snapshot, edits), text: applied }
  }
  if (roll < 0.6 || text.length === 0) {
    const from = pick(random, text.length + 1)
    const inserted = randomText(random, 12)
    return {
      snapshot: insertIntoPieceTable(snapshot, from, inserted),
      text: spliceText(text, { from, to: from, text: inserted }),
    }
  }
  const from = pick(random, text.length)
  const span = random() < 0.1 ? text.length >> 2 : 24
  const to = Math.min(text.length, from + 1 + pick(random, span))
  return {
    snapshot: deleteFromPieceTable(snapshot, from, to - from),
    text: spliceText(text, { from, to, text: '' }),
  }
}

describe('balanced sequence tree', () => {
  test.each([
    [0, 1],
    [1, 7],
    [40, 20260916],
    [2000, 42],
  ])('matches a string model from %i lines, seed %i', (lines, seed) => {
    const random = createRandom(seed)
    let state: State = { snapshot: createPieceTableSnapshot(documentOf(lines)), text: '' }
    state.text = materializePieceTableFullText(state.snapshot)
    const retained: State[] = []
    const anchors = [anchorAt(state.snapshot, 0, 'right')]

    for (let edit = 0; edit < 600; edit += 1) {
      if (edit % 40 === 0) retained.push(state)
      if (anchors.length < 40) {
        anchors.push(anchorAt(state.snapshot, pick(random, state.text.length + 1), 'left'))
      }
      state = stepRandom(state, random)
      if (edit % 10 === 0) expectMatchesModel(state.snapshot, state.text, random)
      for (const anchor of anchors) {
        expect(resolveAnchor(state.snapshot, anchor)).toEqual(
          resolveAnchorLinear(state.snapshot, anchor),
        )
      }
    }

    expectMatchesModel(state.snapshot, state.text, random)
    for (const old of retained) expect(materializePieceTableFullText(old.snapshot)).toBe(old.text)
  })

  // A join that failed to rebalance shows here: each trace grows one spine.
  test.each([
    ['prepend', () => 0],
    ['append', (length: number) => length],
    ['fixed middle', (length: number) => length >> 1],
    ['alternating ends', (length: number, edit: number) => (edit % 2 ? 0 : length)],
    ['walking cut', (length: number, edit: number) => (edit * 7) % (length + 1)],
  ])('stays within the height bound under %s inserts', (_name, offsetOf) => {
    let snapshot = createPieceTableSnapshot(documentOf(50))
    for (let edit = 0; edit < 3000; edit += 1) {
      // Alternating texts defeat coalescing so every insert adds a node.
      snapshot = insertIntoPieceTable(snapshot, offsetOf(snapshot.length, edit), `${edit}\n`)
      if (edit % 2 === 0)
        snapshot = deleteFromPieceTable(snapshot, offsetOf(snapshot.length, edit) >> 1, 1)
    }
    expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
    expectHeightBound(snapshot)
    expect(snapshot.pieceCount).toBeGreaterThan(3000)
  })

  // A join that mutated a shared node would corrupt the older branch.
  test('an old snapshot edits independently after the tree rebalanced', () => {
    const random = createRandom(99)
    let trunk: State = { snapshot: createPieceTableSnapshot(documentOf(30)), text: '' }
    trunk.text = materializePieceTableFullText(trunk.snapshot)
    for (let edit = 0; edit < 200; edit += 1) trunk = stepRandom(trunk, random)
    const fork = trunk

    let first = fork
    let second = fork
    for (let edit = 0; edit < 300; edit += 1) first = stepRandom(first, random)
    for (let edit = 0; edit < 300; edit += 1) second = stepRandom(second, random)

    expectMatchesModel(first.snapshot, first.text, random)
    expectMatchesModel(second.snapshot, second.text, random)
    expectMatchesModel(fork.snapshot, fork.text, random)
  })

  // Orders run out between two neighbours; relabelling must keep the shape valid.
  test('normalizes orders without breaking the balance', () => {
    let snapshot = createPieceTableSnapshot('ab')
    for (let edit = 0; edit < 120; edit += 1)
      snapshot = insertIntoPieceTable(snapshot, 1, `${edit % 10}`)
    expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
    expect(materializePieceTableFullText(snapshot)).toHaveLength(122)
  })
})
