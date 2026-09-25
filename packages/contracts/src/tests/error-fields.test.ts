import { describe, expect, it } from 'vitest'

import { errorNumberField, errorStringField, errorSummary } from '../error-fields'

describe('error field helpers', () => {
  it('reads string fields from errors and error-like records', () => {
    const error = Object.assign(new Error('failed'), { code: 'ENOENT' })

    expect(errorStringField(error, 'code')).toBe('ENOENT')
    expect(errorStringField({ code: 'ENOENT' }, 'code')).toBe('ENOENT')
    expect(errorStringField(error, 'status')).toBeUndefined()
    expect(errorStringField(error, 'missing')).toBeUndefined()
  })

  it('reads finite number fields from errors', () => {
    const error = Object.assign(new Error('failed'), {
      code: 'ENOENT',
      retryAfter: Number.POSITIVE_INFINITY,
      status: 404,
    })

    expect(errorNumberField(error, 'status')).toBe(404)
    expect(errorNumberField(error, 'retryAfter')).toBeUndefined()
    expect(errorNumberField(error, 'code')).toBeUndefined()
  })

  it('can limit string fields while preserving either edge', () => {
    const error = Object.assign(new Error('failed'), { detail: 'abcdef' })

    expect(errorStringField(error, 'detail', { maxLength: 3 })).toBe('abc')
    expect(errorStringField(error, 'detail', { maxLength: 3, preserve: 'end' })).toBe('def')
  })
})

describe('errorSummary', () => {
  const long = `${'a'.repeat(600)}${'z'.repeat(10)}`

  it('reads statusCode before status', () => {
    const error = Object.assign(new Error('failed'), { status: 409, statusCode: 503 })

    expect(errorSummary(error).status).toBe(503)
    expect(errorSummary({ status: 409, statusCode: 503 }).status).toBe(503)
  })

  it('keeps the message whole and leaves out guidance by default', () => {
    const error = Object.assign(new Error(long), { code: 'x.FAILED', fix: 'Retry.', why: 'Broke.' })

    expect(errorSummary(error)).toEqual({
      code: 'x.FAILED',
      message: long,
      name: 'Error',
      status: undefined,
    })
  })

  it('limits message and guidance with the caller-named edge', () => {
    const error = Object.assign(new Error(long), { fix: long, why: 'Broke.' })
    const summary = errorSummary(error, {
      guidance: true,
      limit: { maxLength: 500, preserve: 'end' },
    })

    expect(summary.message).toBe(long.slice(-500))
    expect(summary).toMatchObject({ fix: long.slice(-500), why: 'Broke.' })
  })

  it('keeps code and status for a thrown non-Error', () => {
    expect(errorSummary({ code: 'lsp.FAILED', status: 502 })).toEqual({
      code: 'lsp.FAILED',
      message: '[object Object]',
      name: 'object',
      status: 502,
    })
    expect(errorSummary('boom', { limit: { maxLength: 2 } })).toMatchObject({
      message: 'bo',
      name: 'string',
    })
  })
})
