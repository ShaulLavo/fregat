import { describe, expect, it } from 'vitest'
import { createError } from '@singapore-editor/core/logging/evlog'

describe('evlog logging helpers', () => {
  it('creates structured errors with readable diagnostics and private internal context', () => {
    const cause = new Error('native failure')
    const error = createError({
      cause,
      code: 'test.STRUCTURED_ERROR',
      fix: 'Use the structured fields instead of a bare message.',
      internal: { worker: 'minimap' },
      message: 'Operation failed',
      why: 'The underlying worker crashed.',
    })

    expect(error).toMatchObject({
      cause,
      code: 'test.STRUCTURED_ERROR',
      name: 'EvlogError',
      status: 500,
      why: 'The underlying worker crashed.',
    })
    expect(error.internal).toEqual({ worker: 'minimap' })
    expect(error.toString()).toContain('Code: test.STRUCTURED_ERROR')
    expect(error.toString()).toContain('Fix: Use the structured fields instead of a bare message.')
    expect(JSON.stringify(error)).not.toContain('minimap')
  })
})
