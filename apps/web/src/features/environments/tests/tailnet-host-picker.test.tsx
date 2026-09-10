import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'

import { MachineForm } from '@/components/machine-form'
import { fetchSettings } from '@/features/settings/utils/api'
import { tailnetPeer, tailnetStatusCommand } from '../../../../../server/test/factories/tailnet'
import { createFederationHarness } from '../../../../test/factories/federation'
import { writeSshConfig } from '../../../../test/factories/ssh-config'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'

test('lists SSH aliases and tailnet peers together and saves the chosen tailnet target', async () => {
  const server = await makeTestServer({
    filesystemWatch: false,
    machines: {
      tailnetStatusCommand: tailnetStatusCommand({
        peers: [
          tailnetPeer(),
          tailnetPeer({
            ID: 'sleeping',
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
  const h = await createFederationHarness(server)
  await writeSshConfig(server.root, 'Host my-ssh-alias\n')
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />, {
    connections: h.connections,
  })
  expect(await screen.findByRole('button', { name: 'my-ssh-alias' })).toBeVisible()
  const tailnet = within(screen.getByRole('group', { name: 'Tailnet machines' }))
  expect(await tailnet.findByRole('button', { name: /^devbox / })).toBeVisible()
  const offline = tailnet.getByRole('button', { name: /^sleeping / })
  expect(offline).toHaveTextContent('Offline')
  expect(offline).toBeEnabled()
  await userEvent.type(screen.getByLabelText('SSH target'), 'devbox')
  expect(tailnet.queryByRole('button', { name: /^sleeping / })).toBeNull()
  await userEvent.click(tailnet.getByRole('button', { name: /^devbox / }))
  expect(screen.getByLabelText('SSH target')).toHaveValue('devbox.example.ts.net')
  await userEvent.click(screen.getByRole('button', { name: 'Add machine' }))
  await waitFor(async () =>
    expect((await fetchSettings(undefined, h.clientA)).values['environments.machines']).toEqual({
      'devbox-example-ts-net': { kind: 'ssh', target: 'devbox.example.ts.net' },
    }),
  )
})

test('refreshing an unavailable tailnet shows progress while SSH aliases remain usable', async () => {
  const pending = Promise.withResolvers<string>()
  onTestFinished(() => pending.resolve('{"BackendState":"Stopped"}'))
  let calls = 0
  const server = await makeTestServer({
    filesystemWatch: false,
    machines: {
      tailnetStatusCommand: () => {
        calls += 1
        if (calls === 1) return tailnetStatusCommand({ backendState: 'Stopped' })()
        return pending.promise
      },
    },
  })
  onTestFinished(server.cleanup)
  const h = await createFederationHarness(server)
  await writeSshConfig(server.root, 'Host available-ssh\n')
  renderWithProviders(<MachineForm onCancel={() => {}} onSaved={() => {}} />, {
    connections: h.connections,
  })
  const refresh = await screen.findByRole('button', { name: 'Refresh tailnet' })
  await userEvent.click(refresh)
  await waitFor(() => expect(refresh).toBeDisabled())
  expect(screen.getByRole('button', { name: 'available-ssh' })).toBeEnabled()
  await act(async () => pending.resolve(await tailnetStatusCommand({ peers: [tailnetPeer()] })()))
  expect(await screen.findByRole('button', { name: /^devbox / })).toBeVisible()
})
