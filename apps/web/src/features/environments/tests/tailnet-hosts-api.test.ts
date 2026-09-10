import { onTestFinished } from 'vitest'
import { tailnetPeer, tailnetStatusCommand } from '../../../../../server/test/factories/tailnet'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test('lists tailnet peers with their SSH target and online status through the real route', async () => {
  const server = await makeTestServer({
    filesystemWatch: false,
    machines: {
      tailnetStatusCommand: tailnetStatusCommand({
        peers: [
          tailnetPeer(),
          tailnetPeer({
            ID: 'offline',
            HostName: 'sleeping',
            DNSName: 'sleeping.example.ts.net.',
            TailscaleIPs: ['100.64.0.3'],
            Online: false,
          }),
        ],
      }),
    },
  })
  onTestFinished(server.cleanup)
  const response = await createInProcessClient(server).machines['tailnet-hosts'].get()
  expect(response.error).toBeNull()
  expect(response.data).toEqual({
    status: 'available',
    hosts: [
      { target: 'devbox.example.ts.net', label: 'devbox', online: true },
      { target: 'sleeping.example.ts.net', label: 'sleeping', online: false },
    ],
  })
})

test('stopped Tailscale returns unavailable rather than a false empty tailnet', async ({
  client,
}) => {
  const response = await client.machines['tailnet-hosts'].get()
  expect(response.error).toBeNull()
  expect(response.data).toEqual({ status: 'unavailable', hosts: [], reason: 'not-running' })
})

test('tailnet status errors are isolated from SSH config discovery', async () => {
  const server = await makeTestServer({
    filesystemWatch: false,
    machines: { tailnetStatusCommand: async () => 'invalid json' },
  })
  onTestFinished(server.cleanup)
  const client = createInProcessClient(server)
  expect((await client.machines['tailnet-hosts'].get()).data).toEqual({
    status: 'unavailable',
    hosts: [],
    reason: 'failed',
  })
  expect((await client.machines['ssh-hosts'].get()).data).toEqual({ hosts: [] })
})

test('untrusted origins cannot enumerate tailnet peers', async ({ server }) => {
  const response = await server.app.handle(
    new Request('http://local/machines/tailnet-hosts', {
      headers: { origin: 'https://untrusted.example' },
    }),
  )
  expect(response.status).toBe(403)
})
