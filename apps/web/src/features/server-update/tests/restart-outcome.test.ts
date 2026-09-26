import type { ServerUpdate } from '@workspace/contracts'

import { expect, test } from '../../../../test/fixtures'
import {
  isRestartDisconnect,
  showsRestarting,
  type RestartMarker,
} from '@/features/server-update/utils/restart-outcome'
import { createRpcError } from '@/lib/structured-errors'

const STAGED: ServerUpdate = {
  phase: 'serving',
  pending: { release: 'staged-release', stagedAt: '2026-09-25T00:00:00.000Z' },
  liveCheck: null,
}
const ON_SERVER_1 = { phase: 'connected', serverInstanceId: 'server-1' } as const

function marker(confirmed: boolean, update = STAGED): RestartMarker {
  return { update, instance: 'server-1', confirmed }
}

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

test('an unconfirmed marker shows restarting only off the instance it asked', () => {
  expect(showsRestarting(STAGED, marker(false), ON_SERVER_1)).toBe(false)
  expect(showsRestarting(STAGED, marker(false), { ...ON_SERVER_1, phase: 'disconnected' })).toBe(
    true,
  )
  expect(
    showsRestarting(STAGED, marker(false), { ...ON_SERVER_1, serverInstanceId: 'server-2' }),
  ).toBe(true)
})

test('a confirmed marker holds until the next push replaces the update it was set on', () => {
  expect(showsRestarting(STAGED, marker(true), ON_SERVER_1)).toBe(true)
  expect(showsRestarting({ ...STAGED }, marker(true), ON_SERVER_1)).toBe(false)
  expect(showsRestarting({ ...STAGED, phase: 'restarting' }, null, ON_SERVER_1)).toBe(true)
})
