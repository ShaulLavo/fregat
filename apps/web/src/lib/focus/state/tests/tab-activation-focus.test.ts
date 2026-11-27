import { describe } from 'vitest'

import {
  recordTabActivationFocus,
  tabShouldAutoFocus,
} from '@/lib/focus/state/tab-activation-focus'
import { expect, test } from '../../../../../test/fixtures'

describe('tabActivationFocus', () => {
  test('defaults to auto-focusing and suppresses auto-focus for touch activations', () => {
    const id = 'tab-settings-touch'
    expect(tabShouldAutoFocus(id)).toBe(true)

    recordTabActivationFocus(id, { shouldFocusEditor: false, origin: 'touch' })
    expect(tabShouldAutoFocus(id)).toBe(false)

    recordTabActivationFocus(id, { shouldFocusEditor: true, origin: 'mouse' })
    expect(tabShouldAutoFocus(id)).toBe(true)

    recordTabActivationFocus(id, undefined)
    expect(tabShouldAutoFocus(id)).toBe(true)
  })
})
