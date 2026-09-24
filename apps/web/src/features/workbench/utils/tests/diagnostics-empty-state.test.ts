import { describe, expect, it } from 'vitest'

import { diagnosticsEmptyState } from '@/features/workbench/utils/diagnostics-empty-state'

describe('diagnosticsEmptyState', () => {
  it('reads as clean only for an answer about the current text', () => {
    expect(diagnosticsEmptyState('ready', 'current')).toBe('clean')
    expect(diagnosticsEmptyState('ready', 'refreshing')).toBe('rechecking')
  })

  it('waits while a first answer is being asked for', () => {
    expect(diagnosticsEmptyState('loading', undefined)).toBe('loading')
    expect(diagnosticsEmptyState('ready', 'awaiting')).toBe('loading')
  })

  it('never waits on a server that has said nothing', () => {
    expect(diagnosticsEmptyState('ready', 'silent')).toBe('silent')
    expect(diagnosticsEmptyState('ready', undefined)).toBe('silent')
  })

  it('says a lost connection is unavailable, not clean', () => {
    expect(diagnosticsEmptyState('error', undefined)).toBe('unavailable')
    expect(diagnosticsEmptyState('ready', 'unavailable')).toBe('unavailable')
  })
})
