import { describe, expect, it } from 'vitest'

import { FsError, errorPayload, mapNodeError } from '../errors'

describe('FsError', () => {
  it('maps common Node filesystem errors while sanitizing diagnostic causes', () => {
    const cause = Object.assign(new Error("ENOENT: no such file, stat '/tmp/private/file.txt'"), {
      code: 'ENOENT',
      path: '/tmp/private/file.txt',
      syscall: 'stat',
    })
    const error = mapNodeError(cause)

    expect(error.code).toBe('NOT_FOUND')
    expect(error.statusCode).toBe(404)
    expect(error.cause).toEqual({
      code: 'ENOENT',
      message: "ENOENT: no such file, stat '[redacted]'",
      name: 'Error',
      path: '[redacted]',
      syscall: 'stat',
    })
  })

  it('redacts credential keys from the cause and its internal copy', () => {
    const cause = Object.assign(new Error("request to 'https://example.test' failed"), {
      authorization: 'Bearer secret-token',
      request: { body: 'payload', headers: { cookie: 'a=b', 'x-api-key': 'key' }, method: 'PUT' },
      token: 'secret-token',
    })
    const error = new FsError('OPERATION_FAILED', undefined, cause)
    const expected = {
      authorization: '[redacted]',
      message: "request to '[redacted]' failed",
      name: 'Error',
      request: {
        body: '[redacted]',
        headers: { cookie: '[redacted]', 'x-api-key': '[redacted]' },
        method: 'PUT',
      },
      token: '[redacted]',
    }

    expect(error.cause).toEqual(expected)
    expect(error.internal?.cause).toEqual(expected)
    expect(JSON.stringify([error.cause, error.internal])).not.toContain('secret-token')
  })

  it('says a permission error is one, with a fix the user can act on', () => {
    for (const code of ['EACCES', 'EPERM']) {
      const cause = Object.assign(new Error(`${code}: permission denied, scandir '/x'`), {
        code,
        path: '/x',
        syscall: 'scandir',
      })
      const error = mapNodeError(cause)

      expect(error.code).toBe('PERMISSION_DENIED')
      expect(error.statusCode).toBe(403)
      expect(error.why).toBeTruthy()
      expect(error.fix).toBeTruthy()
    }
  })

  it('keeps public error payloads stable', () => {
    const error = new FsError('OPERATION_FAILED', 'failed internally', {
      detail: 'private',
    })

    expect(errorPayload(error)).toEqual({
      error: {
        code: 'OPERATION_FAILED',
        message: 'failed internally',
      },
    })
  })
})
