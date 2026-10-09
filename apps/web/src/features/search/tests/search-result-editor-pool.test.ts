import { describe, expect, it } from 'vitest'

import type {
  SearchResultFileEditorSlot,
  SearchResultRenderedFileResultItem,
} from '@/features/search/utils/result-editor-types'
import { syncSearchResultFileEditorSlots } from '@/features/search/state/result-editor-pool'

const FILE_HEIGHT = 100
const VIEWPORT = { height: 300, top: 0 }

describe('search result editor slots', () => {
  it('gives each file with lines in view a slot, in file order', () => {
    const slots = sync([], files(0, 3))

    expect(slots.map((slot) => [slot.key, slot.item.row.file.id, slot.visible])).toEqual([
      ['slot:0', 'file:0', true],
      ['slot:1', 'file:1', true],
      ['slot:2', 'file:2', true],
    ])
  })

  it('skips files whose line window is empty', () => {
    const far = file(100)

    expect(sync([], files(0, 2).concat([far])).map((slot) => slot.item.row.file.id)).toEqual([
      'file:0',
      'file:1',
    ])
  })

  it('hands a freed slot to the next file that scrolls in and keeps the rest in place', () => {
    const first = sync([], files(0, 3))
    const next = sync(first, files(1, 4), { height: 300, top: 100 })

    expect(next.map((slot) => [slot.key, slot.item.row.file.id])).toEqual([
      ['slot:0', 'file:3'],
      ['slot:1', 'file:1'],
      ['slot:2', 'file:2'],
    ])
    expect(next[1]?.lineWindow).toEqual(first[1]?.lineWindow)
  })

  it('builds no new slot while a fling passes through a hundred files', () => {
    let slots = sync([], files(0, 3))
    for (let start = 1; start < 100; start += 1) {
      slots = sync(slots, files(start, start + 3), { height: 300, top: start * FILE_HEIGHT })
    }

    expect(slots.map((slot) => slot.key)).toEqual(['slot:0', 'slot:1', 'slot:2'])
  })

  it('parks slots with no file in view and keeps their last file', () => {
    const first = sync([], files(0, 3))
    const next = sync(first, files(0, 1))

    expect(next.map((slot) => [slot.item.row.file.id, slot.visible])).toEqual([
      ['file:0', true],
      ['file:1', false],
      ['file:2', false],
    ])
    expect(next[0]).toBe(first[0])
    expect(sync(next, files(0, 1))).toBe(next)
  })

  it('keeps the slots array while the same files stay in view', () => {
    const items = files(0, 3)
    const first = sync([], items)

    expect(
      sync(
        first,
        items.map((item) => ({ ...item })),
      ),
    ).toBe(first)
  })
})

function sync(
  slots: readonly SearchResultFileEditorSlot[],
  items: readonly SearchResultRenderedFileResultItem[],
  viewport = VIEWPORT,
) {
  return syncSearchResultFileEditorSlots(slots, items, viewport)
}

function files(start: number, end: number) {
  return Array.from({ length: end - start }, (_, index) => file(start + index))
}

const fileRows = new Map<number, SearchResultRenderedFileResultItem>()

function file(index: number): SearchResultRenderedFileResultItem {
  const cached = fileRows.get(index)
  if (cached) return cached

  const id = `file:${index}`
  const item = {
    renderKey: id,
    row: { file: { excerpts: [{ id: `${id}:line` }], id }, type: 'file-results' },
    virtualItem: { index, key: id, size: FILE_HEIGHT, start: index * FILE_HEIGHT },
  } as unknown as SearchResultRenderedFileResultItem
  fileRows.set(index, item)
  return item
}
