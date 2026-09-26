import { describe, expect, it } from 'vitest'

import { operatorErrorSummary } from '../logging'

describe('operatorErrorSummary', () => {
  it('keeps the tail of the message and fix, adds why, and prefers statusCode', () => {
    const message = `${'m'.repeat(100)}${'cause'.repeat(100)}`
    const fix = `${'f'.repeat(100)}${'remedy'.repeat(100)}`
    const error = Object.assign(new Error(message), {
      code: 'fs.OPERATION_FAILED',
      fix,
      status: 409,
      statusCode: 503,
      why: 'The disk is full.',
    })

    expect(operatorErrorSummary(error)).toEqual({
      code: 'fs.OPERATION_FAILED',
      fix: fix.slice(-500),
      message: message.slice(-500),
      name: 'Error',
      status: 503,
      why: 'The disk is full.',
    })
  })
})
