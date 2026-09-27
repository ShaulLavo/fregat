import { describe, expect, it } from 'vitest'

import { tabsForPhoneOpen } from '@/lib/shell/utils/phone-tab'

describe('tabsForPhoneOpen', () => {
  it('adds the first file the phone opens and owns it', () => {
    expect(tabsForPhoneOpen(['desk'], 'a', null)).toEqual({ tabs: ['desk', 'a'], own: 'a' })
  })

  it('puts the next file in the place of the one the phone opened', () => {
    expect(tabsForPhoneOpen(['a', 'desk'], 'b', 'a')).toEqual({ tabs: ['b', 'desk'], own: 'b' })
  })

  it('closes its own tab when it shows one that was already open, and owns nothing', () => {
    expect(tabsForPhoneOpen(['desk', 'a'], 'desk', 'a')).toEqual({ tabs: ['desk'], own: null })
  })

  it('never closes a tab it found open', () => {
    expect(tabsForPhoneOpen(['desk', 'other'], 'b', null)).toEqual({
      tabs: ['desk', 'other', 'b'],
      own: 'b',
    })
  })

  it('reopening its own file changes nothing', () => {
    expect(tabsForPhoneOpen(['desk', 'a'], 'a', 'a')).toEqual({ tabs: ['desk', 'a'], own: 'a' })
  })

  it('appends when its own tab was already closed elsewhere', () => {
    expect(tabsForPhoneOpen(['desk'], 'b', 'a')).toEqual({ tabs: ['desk', 'b'], own: 'b' })
  })
})
