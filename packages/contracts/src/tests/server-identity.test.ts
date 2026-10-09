import { describe, expect, it } from 'vitest'
import { descriptorFor } from '../settings/keys'
import * as v from 'valibot'

import { nativePickerRequestSchema, nativePickerResultSchema } from '../native-picker'
import { serverCapabilitiesSchema, serverIdentitySchema } from '../server-identity'

const identity = {
  product: 'fregat',
  protocolVersion: 1,
  machineId: '0123456789abcdef0123456789abcdef',
  environmentId: '6f1d1c2e-3b9a-4f0e-9d7a-2b8c5e4f1a90',
  stateHome: '/home/someone/.platform',
  address: 'http://127.0.0.1:3301',
  webBase: '/',
  service: { kind: 'systemd-socket', registrationId: 'fregat-server.socket' },
}

describe('server identity', () => {
  it('accepts a socket-activated identity', () => {
    expect(v.safeParse(serverIdentitySchema, identity).success).toBe(true)
  })

  it.each([
    ['an address with a path', { address: 'http://127.0.0.1:3301/platform' }],
    ['a relative state home', { stateHome: '.platform' }],
    ['a web base without its trailing slash', { webBase: '/platform' }],
    ['another product', { product: 'other' }],
    ['an uppercase machine id', { machineId: '0123456789ABCDEF0123456789ABCDEF' }],
  ])('refuses %s', (_, change) => {
    expect(v.safeParse(serverIdentitySchema, { ...identity, ...change }).success).toBe(false)
  })

  it('reports the native picker as one boolean for the asking request', () => {
    const capabilities = {
      machineId: identity.machineId,
      environmentId: '6f1d1c2e-3b9a-4f0e-9d7a-2b8c5e4f1a90',
    }
    expect(
      v.safeParse(serverCapabilitiesSchema, { ...capabilities, nativePicker: false }),
    ).toMatchObject({ success: true })
    expect(
      v.safeParse(serverCapabilitiesSchema, { ...capabilities, nativePicker: { available: true } })
        .success,
    ).toBe(false)
  })
})

describe('native picker', () => {
  it('accepts a request without a starting folder', () => {
    expect(v.safeParse(nativePickerRequestSchema, {}).success).toBe(true)
  })

  it.each(['/tmp', 'C:\\Users\\person', 'D:/work', '\\\\server\\share\\folder'])(
    'accepts the absolute starting path %s',
    (startingPath) => {
      expect(v.safeParse(nativePickerRequestSchema, { startingPath }).success).toBe(true)
    },
  )

  it.each(['tmp', 'C:Users', '\\\\server', '/tmp/a\0b'])(
    'refuses the starting path %j',
    (startingPath) => {
      expect(v.safeParse(nativePickerRequestSchema, { startingPath }).success).toBe(false)
    },
  )

  it.each([
    ['a file mode', { mode: 'file' }],
    ['file types', { accept: ['.ts'] }],
    ['multiple selection', { multiple: true }],
  ])('refuses %s', (_, request) => {
    expect(v.safeParse(nativePickerRequestSchema, request).success).toBe(false)
  })

  it('keeps cancellation empty and a selection to one folder', () => {
    expect(v.safeParse(nativePickerResultSchema, { outcome: 'cancelled', paths: [] }).success).toBe(
      true,
    )
    expect(
      v.safeParse(nativePickerResultSchema, { outcome: 'cancelled', paths: ['/a'] }).success,
    ).toBe(false)
    expect(v.safeParse(nativePickerResultSchema, { outcome: 'selected', paths: [] }).success).toBe(
      false,
    )
    expect(
      v.safeParse(nativePickerResultSchema, { outcome: 'selected', paths: ['/a'] }).success,
    ).toBe(true)
    expect(
      v.safeParse(nativePickerResultSchema, { outcome: 'selected', paths: ['/a', '/b'] }).success,
    ).toBe(false)
  })
})

describe('server release folder setting', () => {
  it('takes empty or an absolute path without NUL', () => {
    const schema = descriptorFor('server.releaseRoot').schema
    expect(v.safeParse(schema, '').success).toBe(true)
    expect(v.safeParse(schema, '/srv/fregat').success).toBe(true)
    expect(v.safeParse(schema, '/srv/a\0b').success).toBe(false)
    expect(v.safeParse(schema, 'srv').success).toBe(false)
  })
})
