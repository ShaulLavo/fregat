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
