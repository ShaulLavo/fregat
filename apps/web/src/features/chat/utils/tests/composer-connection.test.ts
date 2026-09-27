import { expect, test } from '../../../../../test/fixtures'
import { composerConnection } from '@/features/chat/utils/composer-connection'

test('automatic recovery explains drafting while a blocked connection retains its error', () => {
  const sync = { attempt: 1, error: 'Socket closed unexpectedly.', status: 'reconnecting' as const }
  expect(composerConnection({ closed: false, sync, unavailable: null })).toEqual({
    kind: 'reconnecting',
    label: 'Reconnecting chat…',
    detail: 'You can keep drafting while we reconnect.',
  })
  expect(
    composerConnection({ closed: false, sync: { ...sync, status: 'blocked' }, unavailable: null }),
  ).toEqual({
    kind: 'disconnected',
    label: 'Chat disconnected',
    detail: sync.error,
  })
  expect(
    composerConnection({
      closed: false,
      sync: { ...sync, status: 'live', error: null },
      unavailable: null,
    }),
  ).toEqual({ kind: 'live' })
})
