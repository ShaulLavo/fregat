import { describe, expect, it } from 'vitest'

import { parentLevel, phoneLevel } from '@/features/phone/utils/level'

describe('phone levels', () => {
  it('shows the session list while no session is chosen and no screen is pushed', () => {
    expect(phoneLevel('auto', null)).toBe('sessions')
  })

  it('shows a screen pushed over the list, such as settings or quick open', () => {
    expect(phoneLevel('auto', 'file')).toBe('file')
  })

  it('stacks a pushed screen above the chosen session or draft', () => {
    expect(phoneLevel('session', null)).toBe('session')
    expect(phoneLevel('draft', null)).toBe('session')
    expect(phoneLevel('session', 'file')).toBe('file')
  })

  it('backs out one level at a time and stops at the session list', () => {
    expect(parentLevel('file', 'session')).toBe('session')
    expect(parentLevel('terminal', 'session')).toBe('session')
    expect(parentLevel('session', 'session')).toBe('sessions')
    expect(parentLevel('sessions', 'auto')).toBeNull()
  })

  it('backs a screen pushed over the list out to the list', () => {
    expect(parentLevel('file', 'auto')).toBe('sessions')
  })
})
