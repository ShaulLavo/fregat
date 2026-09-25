import { describe, expect, it } from 'vitest'

import { diagnosticsEmptyState } from '@/features/workbench/utils/diagnostics-empty-state'

const ALL_ANSWERING = { failed: 0, pending: 0 }

describe('diagnosticsEmptyState', () => {
  it('reads as clean only for an answer about the current text', () => {
    expect(diagnosticsEmptyState('ready', 'current', ALL_ANSWERING)).toBe('clean')
    expect(diagnosticsEmptyState('ready', 'refreshing', ALL_ANSWERING)).toBe('rechecking')
  })

  it('waits while a first answer is being asked for', () => {
    expect(diagnosticsEmptyState('loading', undefined, ALL_ANSWERING)).toBe('loading')
    expect(diagnosticsEmptyState('ready', 'awaiting', ALL_ANSWERING)).toBe('loading')
  })

  it('never waits on a server that has said nothing', () => {
    expect(diagnosticsEmptyState('ready', 'silent', ALL_ANSWERING)).toBe('silent')
    expect(diagnosticsEmptyState('ready', undefined, ALL_ANSWERING)).toBe('silent')
  })

  it('says a lost connection is unavailable, not clean', () => {
    expect(diagnosticsEmptyState('error', undefined, ALL_ANSWERING)).toBe('unavailable')
    expect(diagnosticsEmptyState('ready', 'unavailable', ALL_ANSWERING)).toBe('unavailable')
  })

  it('does not let one clean server speak for one that failed or has not answered', () => {
    expect(diagnosticsEmptyState('ready', 'current', { failed: 1, pending: 0 })).toBe('unavailable')
    expect(diagnosticsEmptyState('ready', 'current', { failed: 0, pending: 1 })).toBe('loading')
  })
})
