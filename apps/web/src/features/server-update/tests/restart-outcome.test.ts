import { expect, test } from '../../../../test/fixtures'
import { isRestartDisconnect } from '@/features/server-update/utils/restart-outcome'
import { createRpcError } from '@/lib/structured-errors'

test('a dropped request counts as a disconnect through Eden and a gateway, a refusal does not', () => {
  expect(
    isRestartDisconnect(createRpcError({ status: 503, value: new TypeError('Failed to fetch') })),
  ).toBe(true)
  expect(isRestartDisconnect(createRpcError({ status: 502, value: 'Bad Gateway' }))).toBe(true)
  expect(
    isRestartDisconnect(
      createRpcError({ status: 409, value: { code: 'NO_UPDATE_STAGED', message: 'No update' } }),
    ),
  ).toBe(false)
})
