import { expect, it, vi } from 'vitest'
import { createStringTextSnapshot } from '@singapore-editor/core/document'
import {
  editedByteDelta,
  snapshotBytes,
  textBytes,
} from '@/features/editor/utils/typescript-worker-bytes'

it.each([
  ['a😀b', [{ from: 2, to: 2, text: 'x' }]],
  ['a\uD800x\uDC00b', [{ from: 2, to: 3, text: '' }]],
  [
    'abcdef',
    [
      { from: 1, to: 2, text: 'é' },
      { from: 4, to: 5, text: '😀' },
    ],
  ],
] as const)('charges exact UTF-8 bytes after edits to %s', (source, edits) => {
  let after: string = source
  for (const edit of edits.toReversed())
    after = after.slice(0, edit.from) + edit.text + after.slice(edit.to)
  expect(editedByteDelta(createStringTextSnapshot(source), edits)).toBe(
    textBytes(after) - textBytes(source),
  )
})
it('reads only the edited neighborhood in a large document', () => {
  const source = 'a'.repeat(1_000_000)
  const readRange = vi.fn((start: number, end: number) => source.slice(start, end))
  expect(
    editedByteDelta({ length: source.length, readRange } as never, [
      { from: 500_000, to: 500_001, text: 'é' },
    ]),
  ).toBe(1)
  expect(readRange).toHaveBeenCalledExactlyOnceWith(499_999, 500_002)
})
it('counts a surrogate pair crossing the bounded snapshot chunks', () => {
  const source = 'a'.repeat(65_535) + '😀'
  expect(snapshotBytes(createStringTextSnapshot(source))).toBe(textBytes(source))
})
