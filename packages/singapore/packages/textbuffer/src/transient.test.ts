import { describe, expect, test } from 'vitest'
import {
  createPieceTableSnapshot,
  deleteFromPieceTable,
  insertIntoPieceTable,
  materializePieceTableFullText,
  retainPieceTableSnapshot,
} from './index'
import { validatePieceTreeInvariants } from './debug'
import { flattenNodes } from './tree'

const text = (snapshot: ReturnType<typeof createPieceTableSnapshot>) =>
  materializePieceTableFullText(snapshot)

describe('transient edits between retains', () => {
  test('an edit of an unretained snapshot reuses its own nodes', () => {
    const first = insertIntoPieceTable(
      createPieceTableSnapshot('abcdef', { transient: true }),
      3,
      'X',
    )
    const before = new Set(flattenNodes(first.root, []))
    const second = insertIntoPieceTable(first, 4, 'Y')
    const after = flattenNodes(second.root, [])
    expect(text(second)).toBe('abcXYdef')
    expect(after.some((node) => before.has(node))).toBe(true)
    expect(first.consumed).toBe(true)
    expect(() => insertIntoPieceTable(first, 0, 'Z')).toThrow(/already edited in place/)
  })

  test('a retained snapshot keeps its text through later in-place edits', () => {
    let snapshot = createPieceTableSnapshot('alpha\nbeta\ngamma', { transient: true })
    const roots = [retainPieceTableSnapshot(snapshot)]
    for (let step = 0; step < 40; step += 1) {
      snapshot = insertIntoPieceTable(snapshot, (step * 7) % snapshot.length, `${step}`)
      snapshot = deleteFromPieceTable(snapshot, (step * 3) % (snapshot.length - 1), 1)
      if (step % 10 === 9) roots.push(retainPieceTableSnapshot(snapshot))
    }
    const texts = roots.map(text)
    snapshot = deleteFromPieceTable(insertIntoPieceTable(snapshot, 0, 'tail'), 2, 3)
    expect(roots.map(text)).toEqual(texts)
    expect(texts[0]).toBe('alpha\nbeta\ngamma')
    for (const root of roots) expect(validatePieceTreeInvariants(root).issues).toEqual([])
    expect(validatePieceTreeInvariants(snapshot).issues).toEqual([])
  })

  test('branches from a retained root never see each other', () => {
    const root = retainPieceTableSnapshot(
      createPieceTableSnapshot('0123456789', { transient: true }),
    )
    const left = insertIntoPieceTable(insertIntoPieceTable(root, 2, 'L'), 5, 'l')
    const right = deleteFromPieceTable(insertIntoPieceTable(root, 7, 'R'), 0, 2)
    expect(text(root)).toBe('0123456789')
    expect(text(left)).toBe('01L23l456789')
    expect(text(right)).toBe('23456R789')
    expect(root.consumed).toBe(false)
  })

  test('the default mode retains before every edit', () => {
    const initial = createPieceTableSnapshot('abc')
    const edited = insertIntoPieceTable(initial, 1, 'X')
    expect(initial.consumed).toBe(false)
    expect(text(insertIntoPieceTable(initial, 0, 'Y'))).toBe('Yabc')
    expect(text(edited)).toBe('aXbc')
    expect(initial.buffers.lineage.epoch).toBeGreaterThan(initial.epoch)
  })
})
