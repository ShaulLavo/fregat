import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import * as v from 'valibot'
import { tailnetPeer, tailnetStatusCommand } from '../../../test/factories/tailnet'
import { discoverTailnetHosts, tailnetDiscoverySchema } from '../tailnet-hosts'

test('lists peers in name order using MagicDNS without its trailing dot', async () => {
  const command = tailnetStatusCommand({
    peers: [
      tailnetPeer({ ID: 'zulu', DNSName: 'zulu.example.ts.net.', TailscaleIPs: ['100.64.0.3'] }),
      tailnetPeer(),
    ],
  })
  const result = await discoverTailnetHosts(command)
  expect(result).toEqual({
    status: 'available',
    hosts: [
      { label: 'devbox', target: 'devbox.example.ts.net', online: true },
      { label: 'zulu', target: 'zulu.example.ts.net', online: true },
    ],
  })
  expect(v.is(tailnetDiscoverySchema, result)).toBe(true)
})

test('excludes the local machine and malformed peers', async () => {
  const command = tailnetStatusCommand({
    peers: [
      tailnetPeer(),
      tailnetPeer({ ID: 'self' }),
      tailnetPeer({ TailscaleIPs: ['100.64.0.1'] }),
      tailnetPeer({ TailscaleIPs: ['not-an-ip'] }),
      { Online: 'true', TailscaleIPs: ['100.64.0.9'] },
      null,
    ],
  })
  expect(await discoverTailnetHosts(command)).toEqual({
    status: 'available',
    hosts: [{ label: 'devbox', target: 'devbox.example.ts.net', online: true }],
  })
})

test('prefers IPv4 when MagicDNS is disabled and retains the readable name', async () => {
  const command = tailnetStatusCommand({
    magicDnsEnabled: false,
    peers: [tailnetPeer({ TailscaleIPs: ['fd7a:115c:a1e0::2', '100.64.0.2'] })],
  })
  expect(await discoverTailnetHosts(command)).toEqual({
    status: 'available',
    hosts: [{ label: 'devbox', target: '100.64.0.2', online: true }],
  })
})

test('uses IPv6 when it is the only valid peer address', async () => {
  const command = tailnetStatusCommand({
    magicDnsEnabled: false,
    peers: [tailnetPeer({ TailscaleIPs: ['not-an-ip', 'fd7a:115c:a1e0::2'] })],
  })
  expect(await discoverTailnetHosts(command)).toEqual({
    status: 'available',
    hosts: [{ label: 'devbox', target: 'fd7a:115c:a1e0::2', online: true }],
  })
})

test.each(['', '-oProxyCommand=bad', 'host;command', 'user@host', 'bad..example', 'a'.repeat(64)])(
  'falls back to the address for invalid or absent DNS name %s',
  async (DNSName) => {
    const command = tailnetStatusCommand({ peers: [tailnetPeer({ DNSName })] })
    expect(await discoverTailnetHosts(command)).toEqual({
      status: 'available',
      hosts: [{ label: 'devbox', target: '100.64.0.2', online: true }],
    })
  },
)

test('deduplicates target addresses', async () => {
  const peer = tailnetPeer()
  expect(await discoverTailnetHosts(tailnetStatusCommand({ peers: [peer, peer] }))).toEqual({
    status: 'available',
    hosts: [{ label: 'devbox', target: 'devbox.example.ts.net', online: true }],
  })
})

test('includes offline peers with their availability', async () => {
  const command = tailnetStatusCommand({ peers: [tailnetPeer({ Online: false })] })
  expect(await discoverTailnetHosts(command)).toEqual({
    status: 'available',
    hosts: [{ label: 'devbox', target: 'devbox.example.ts.net', online: false }],
  })
})

test('distinguishes a reachable tailnet with no peers from unavailable discovery', async () => {
  expect(await discoverTailnetHosts(tailnetStatusCommand())).toEqual({
    status: 'available',
    hosts: [],
  })
})

test.each(['Stopped', 'Starting', 'NeedsLogin', 'NeedsMachineAuth', 'NoState'])(
  'keeps manual entry available when Tailscale state is %s',
  async (backendState) => {
    const result = await discoverTailnetHosts(tailnetStatusCommand({ backendState }))
    expect(result).toEqual({ status: 'unavailable', reason: 'not-running', hosts: [] })
    expect(v.is(tailnetDiscoverySchema, result)).toBe(true)
  },
)

test.each(['not-json', '{}', 'null', '{"BackendState":"Running","Peer":[]}'])(
  'returns unavailable for malformed CLI output %s',
  async (output) => {
    expect(await discoverTailnetHosts(async () => output)).toEqual({
      status: 'unavailable',
      reason: 'failed',
      hosts: [],
    })
  },
)

test('handles an absent CLI without treating it as an empty tailnet', async () => {
  const command = async () => {
    const { stdout } = await promisify(execFile)('/does-not-exist/platform-tailnet-fixture', [])
    return stdout
  }
  expect(await discoverTailnetHosts(command)).toEqual({
    status: 'unavailable',
    reason: 'not-installed',
    hosts: [],
  })
})

test('handles failed status commands without exposing their diagnostics to the browser', async () => {
  const command = async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [
      '-e',
      'console.error("fixture daemon unavailable"); process.exit(1)',
    ])
    return stdout
  }
  expect(await discoverTailnetHosts(command)).toEqual({
    status: 'unavailable',
    reason: 'failed',
    hosts: [],
  })
})
