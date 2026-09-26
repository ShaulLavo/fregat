import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { hasConnectionNotice } from '@/lib/environments/utils/availability'
import {
  connectionNoticeSummary,
  serverUpdateLabel,
} from '@/lib/environments/utils/connection-notice'
import { expect, test } from '../../../../test/fixtures'

const origin = 'http://localhost:38078'

test('initial connection attempts do not present cached identity as a connection failure', () => {
  const entry = createEnvironmentEntry(origin, origin)
  for (const phase of ['offline', 'launching', 'connecting', 'live'] as const) {
    expect(hasConnectionNotice({ ...entry, phase })).toBe(false)
  }
})

test('failed attempts, retries, and lost connections remain visible', () => {
  const entry = createEnvironmentEntry(origin, origin)
  expect(hasConnectionNotice({ ...entry, phase: 'offline', lastErrorAt: 1 })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'connecting', lastErrorAt: 1 })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'reconnecting', connectedAt: 1 })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'blocked' })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'identity-drift' })).toBe(true)
  expect(hasConnectionNotice({ ...entry, phase: 'live', lastErrorAt: 1 })).toBe(false)
})

test('a failed update reads as such and can be tried again; a source primary’s refusal cannot', () => {
  const failed = (code: string) => ({ code, message: 'Update failed.' })
  for (const code of ['NO_BUN', 'OLD_BUN', 'TRANSFER', 'INSTALL', 'IMMUTABLE']) {
    const error = failed(`machines.SSH_UPDATE_${code}`)
    expect(serverUpdateLabel(error)).toBe('Update server')
    expect(connectionNoticeSummary('blocked', error)).toBe('Server update failed')
  }
  expect(serverUpdateLabel(failed('machines.SSH_UPDATE_NOT_A_RELEASE'))).toBeNull()
  expect(serverUpdateLabel(failed('ENVIRONMENT_PROTOCOL_MISMATCH'))).toBeNull()
  expect(serverUpdateLabel(null)).toBeNull()
})

test('offers an install or update only where the server decided one clears the failure', () => {
  const protocol = { code: 'machines.SSH_PROTOCOL', message: 'Protocol mismatch.' }
  expect(serverUpdateLabel(protocol)).toBeNull()
  expect(serverUpdateLabel({ ...protocol, action: 'update' })).toBe('Update server')
  const missing = { code: 'machines.SSH_NOT_INSTALLED', message: 'Not installed.' }
  expect(serverUpdateLabel(missing)).toBeNull()
  expect(serverUpdateLabel({ ...missing, action: 'install' })).toBe('Install server')
})

test('describes either protocol direction without calling a newer server out of date', () => {
  for (const message of [
    'Server speaks protocol 7, this client needs 8.',
    'Server speaks protocol 9, this client needs 8.',
  ]) {
    expect(
      connectionNoticeSummary('blocked', { code: 'ENVIRONMENT_PROTOCOL_MISMATCH', message }),
    ).toBe('Protocol mismatch')
  }
})
