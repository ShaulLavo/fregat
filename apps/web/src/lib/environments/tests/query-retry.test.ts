import { createClientError } from '@workspace/client-core/errors'
import { expect, test } from '../../../../test/fixtures'
import { retryUnlessClientError } from '@/lib/environments/utils/query-retry'

function failure(status: number) {
  return createClientError({ code: 'TEST', message: 'failed', status, why: 'test', fix: 'test' })
}

test.describe('retryUnlessClientError', () => {
  test('never retries a 4xx', () => {
    expect(retryUnlessClientError(0, failure(403))).toBe(false)
    expect(retryUnlessClientError(0, failure(404))).toBe(false)
  })

  test('retries a server fault or a dropped connection once', () => {
    expect(retryUnlessClientError(0, failure(500))).toBe(true)
    expect(retryUnlessClientError(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(retryUnlessClientError(1, failure(500))).toBe(false)
  })
})
