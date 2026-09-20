import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'

import { logRowPointerStart, shouldToggleLogRow } from '@/features/logs/utils/row-interactions'

describe('log row interactions', () => {
  it('toggles for a normal click even without a pointer start event', () => {
    expect(shouldToggleLogRow(pointerEvent(10, 12), null)).toBe(true)
  })

  it('toggles when pointer movement stays within click tolerance', () => {
    const pointerStart = logRowPointerStart(pointerEvent(10, 12))

    expect(shouldToggleLogRow(pointerEvent(13, 16), pointerStart)).toBe(true)
  })

  it('does not toggle when pointer movement looks like text selection', () => {
    const pointerStart = logRowPointerStart(pointerEvent(10, 12))

    expect(shouldToggleLogRow(pointerEvent(16, 12), pointerStart)).toBe(false)
  })
})

function pointerEvent(clientX: number, clientY: number) {
  return { clientX, clientY }
}
