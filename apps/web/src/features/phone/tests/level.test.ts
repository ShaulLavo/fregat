import { describe, expect, it } from 'vitest'

import { parentLevel, phoneLevel } from '@/features/phone/utils/level'

describe('phone levels', () => {
  it('shows the session list while no session is chosen, whatever screen the address names', () => {
    expect(phoneLevel('auto', null)).toBe('sessions')
    expect(phoneLevel('auto', 'changes')).toBe('sessions')
  })

  it('stacks a pushed screen above the chosen session or draft', () => {
    expect(phoneLevel('session', null)).toBe('session')
    expect(phoneLevel('draft', null)).toBe('session')
    expect(phoneLevel('session', 'file')).toBe('file')
  })

  it('backs out one level at a time and stops at the session list', () => {
    expect(parentLevel('file')).toBe('session')
    expect(parentLevel('terminal')).toBe('session')
    expect(parentLevel('session')).toBe('sessions')
    expect(parentLevel('sessions')).toBeNull()
  })
})
