import { expect, test } from 'vitest'

import {
  allowedOriginsForWebPort,
  devPorts,
  portFromEnv,
  runtimeUrl,
  selectAvailablePort,
} from './runtime-network'

test('selects the first available non-server port', async () => {
  const checkedPorts: number[] = []
  const port = await selectAvailablePort({
    blockedPorts: [3001],
    isAvailable: async (candidate) => {
      checkedPorts.push(candidate)
      return candidate === 3002
    },
    preferredPort: 3000,
  })

  expect(port).toBe(3002)
  expect(checkedPorts).toEqual([3000, 3002])
})

test('builds exact origins for the selected web port', () => {
  expect(
    allowedOriginsForWebPort('http://custom.local:4000,http://127.0.0.1:3000', '127.0.0.1', 3000),
  ).toBe(
    'http://127.0.0.1:3000,http://localhost:3000,platform-tui://local,http://custom.local:4000',
  )
})

test('keeps a non-loopback web host exact', () => {
  expect(allowedOriginsForWebPort(undefined, 'custom.local', 4000)).toBe(
    'http://custom.local:4000,platform-tui://local',
  )
})

test('registers the TUI origin once when it is also configured explicitly', () => {
  expect(allowedOriginsForWebPort('platform-tui://local', 'localhost', 5173).split(',')).toEqual([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'platform-tui://local',
  ])
})

test('reads validated ports from runtime environment', () => {
  expect(portFromEnv({}, 'WEB_PORT', 5173)).toBe(5173)
  expect(portFromEnv({ WEB_PORT: '3000' }, 'WEB_PORT', 5173)).toBe(3000)
  expect(() => portFromEnv({ WEB_PORT: 'not-a-port' }, 'WEB_PORT', 5173)).toThrow(
    'WEB_PORT must be an integer between 1 and 65535.',
  )
})

test('brackets IPv6 hosts in runtime URLs', () => {
  expect(runtimeUrl('::1', 3000)).toBe('http://[::1]:3000')
})

test('puts the mesh upstream ports beside the public dev ports', () => {
  expect(devPorts({})).toEqual({ web: 5173, api: 3001, webUpstream: 15173, apiUpstream: 13001 })
  expect(devPorts({ WEB_PORT: '4000', PORT: '4001' })).toMatchObject({
    webUpstream: 14000,
    apiUpstream: 14001,
  })
})
