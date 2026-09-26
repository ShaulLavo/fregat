import { describe, expect, it } from 'vitest'
import {
  listboxKeyAction,
  typeaheadListboxIndex,
  type ListboxKeyInput,
} from '@workspace/ui/patterns/listbox-keys'

const base: ListboxKeyInput = {
  key: 'ArrowDown',
  role: 'listbox',
  count: 12,
  activeIndex: 5,
  pageSize: 4,
}

describe('listbox keys', () => {
  it.each([
    ['ArrowDown', 6],
    ['ArrowUp', 4],
    ['Home', 0],
    ['End', 11],
    ['PageDown', 9],
    ['PageUp', 1],
  ])('moves %s by the expected distance', (key, index) => {
    expect(listboxKeyAction({ ...base, key })).toEqual({ kind: 'move', index })
  })

  it('clamps both ends without wrapping and ignores empty lists', () => {
    expect(listboxKeyAction({ ...base, activeIndex: 11 })).toEqual({ kind: 'move', index: 11 })
    expect(listboxKeyAction({ ...base, key: 'PageUp', activeIndex: 0 })).toEqual({
      kind: 'move',
      index: 0,
    })
    expect(listboxKeyAction({ ...base, count: 0 })).toEqual({ kind: 'none' })
  })

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])(
    'leaves %s chords to the keymap',
    (modifier) => {
      expect(listboxKeyAction({ ...base, modifiers: { [modifier]: true } })).toEqual({
        kind: 'none',
      })
    },
  )

  it('expands a closed tree parent before entering its children', () => {
    expect(
      listboxKeyAction({
        ...base,
        key: 'ArrowRight',
        role: 'tree',
        canCollapse: true,
        isCollapsed: true,
      }),
    ).toEqual({ kind: 'expand' })
    expect(
      listboxKeyAction({
        ...base,
        key: 'ArrowRight',
        role: 'tree',
        canCollapse: true,
        isCollapsed: false,
      }),
    ).toEqual({ kind: 'child' })
    expect(
      listboxKeyAction({
        ...base,
        key: 'ArrowLeft',
        role: 'tree',
        canCollapse: true,
        isCollapsed: false,
      }),
    ).toEqual({ kind: 'collapse' })
    expect(listboxKeyAction({ ...base, key: 'ArrowLeft', role: 'tree' })).toEqual({
      kind: 'parent',
    })
    expect(listboxKeyAction({ ...base, key: 'ArrowRight' })).toEqual({ kind: 'none' })
  })

  describe('typeahead', () => {
    const items = [
      { id: 'a', label: 'about' },
      { id: 'b', label: 'abc', disabled: true },
      { id: 'c', label: 'abcd' },
      { id: 'd', label: 'banana' },
      { id: 'e', label: 'abstract' },
    ]

    it('refines in place while the active row still matches', () => {
      expect(typeaheadListboxIndex(items, 0, 'abo')).toBe(0)
      expect(typeaheadListboxIndex(items, 2, 'abc')).toBe(2)
    })

    it('cycles a single letter from the next row', () => {
      expect(typeaheadListboxIndex(items, 1, 'a')).toBe(2)
      expect(typeaheadListboxIndex(items, 3, 'a')).toBe(4)
    })

    it('skips disabled rows', () => {
      expect(typeaheadListboxIndex(items, 1, 'abc')).toBe(2)
    })

    it('wraps past the end and reports a miss', () => {
      expect(typeaheadListboxIndex(items, 5, 'ab')).toBe(0)
      expect(typeaheadListboxIndex(items, 4, 'b')).toBe(3)
      expect(typeaheadListboxIndex(items, 0, 'zz')).toBe(-1)
    })
  })

  it('moves by rows and tiles in a grid without wrapping', () => {
    const grid = { ...base, count: 10, activeIndex: 5, columns: 4 }
    expect(listboxKeyAction({ ...grid, key: 'ArrowDown' })).toEqual({ kind: 'move', index: 9 })
    expect(listboxKeyAction({ ...grid, key: 'ArrowUp' })).toEqual({ kind: 'move', index: 1 })
    expect(listboxKeyAction({ ...grid, key: 'ArrowRight' })).toEqual({ kind: 'move', index: 6 })
    expect(listboxKeyAction({ ...grid, key: 'ArrowLeft' })).toEqual({ kind: 'move', index: 4 })
    expect(listboxKeyAction({ ...grid, key: 'ArrowDown', activeIndex: 7 })).toEqual({
      kind: 'move',
      index: 7,
    })
  })
})
