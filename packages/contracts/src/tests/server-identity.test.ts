import { describe, expect, it } from 'vitest'
import * as v from 'valibot'

import {
  nativePickerRequestSchema,
  nativePickerResultSchema,
  type NativePickerRequest,
} from '../native-picker'
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
  it('accepts extensions and MIME types', () => {
    const request = {
      mode: 'file',
      accept: ['.ts', 'image/png'],
      startingPath: '/tmp',
      multiple: true,
    }
    expect(v.safeParse(nativePickerRequestSchema, request).success).toBe(true)
  })

  it.each(['/tmp', 'C:\\Users\\person', 'D:/work', '\\\\server\\share\\folder'])(
    'accepts the absolute starting path %s',
    (startingPath) => {
      expect(v.safeParse(nativePickerRequestSchema, { mode: 'folder', startingPath }).success).toBe(
        true,
      )
    },
  )

  it.each(['tmp', 'C:Users', '\\\\server', '/tmp/a\0b'])(
    'refuses the starting path %j',
    (startingPath) => {
      expect(v.safeParse(nativePickerRequestSchema, { mode: 'folder', startingPath }).success).toBe(
        false,
      )
    },
  )

  it('accepts a media range', () => {
    expect(
      v.safeParse(nativePickerRequestSchema, { mode: 'file', accept: ['image/*'] }).success,
    ).toBe(true)
  })

  it.each([
    ['a relative starting path', { mode: 'folder', startingPath: 'tmp' }],
    ['a glob in accept', { mode: 'file', accept: ['*.ts'] }],
    ['a malformed wildcard MIME type', { mode: 'file', accept: ['image/p*ng'] }],
    ['a wildcard type', { mode: 'file', accept: ['*/*'] }],
    ['an unknown mode', { mode: 'save' }],
  ])('refuses %s', (_, request) => {
    expect(v.safeParse(nativePickerRequestSchema, request).success).toBe(false)
  })

  it('keeps cancellation empty and a selection non-empty', () => {
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
  })
})

describe('native picker request type', () => {
  it('takes a readonly accept list', () => {
    const accept: readonly string[] = ['.ts']
    const request: NativePickerRequest = { mode: 'file', accept }
    expect(request.accept).toBe(accept)
  })
})
