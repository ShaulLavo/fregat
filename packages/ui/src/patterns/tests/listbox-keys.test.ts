import { describe, expect, it } from 'vitest'
import { listboxKeyAction, type ListboxKeyInput } from '@workspace/ui/patterns/listbox-keys'

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
})
