import { expect, test } from 'vitest'
import { anchorAfter, createPieceTableSnapshot, resolveAnchor } from '@singapore-editor/textbuffer'

test('the documented surrogate-interior anchor snaps to the code-point start', () => {
  const snapshot = createPieceTableSnapshot('a😀b')
  expect(resolveAnchor(snapshot, anchorAfter(snapshot, 2))).toEqual({ offset: 1, liveness: 'live' })
  expect(() => anchorAfter(snapshot, -1)).toThrow(RangeError)
  expect(() => anchorAfter(snapshot, snapshot.length + 1)).toThrow(RangeError)
})
