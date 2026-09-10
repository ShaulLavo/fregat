import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'

import { MachinePickerDialog } from '@/components/machine-picker-dialog'
import { fetchSettings } from '@/features/settings/utils/api'
import { createTestEnvironmentConnections } from '../../../../test/factories/environment-connections'
import { createFederationHarness } from '../../../../test/factories/federation'
import { createSshEnvironmentFixture } from '../../../../test/factories/ssh-environment'
import { writeSshConfig } from '../../../../test/factories/ssh-config'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { server as httpServer } from '../../../../test/msw/server'

test('adds and connects a machine from the empty picker through real settings and transport', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await h.connections.disconnectMachine('remote')
  h.connections.configureMachines({})
  let closed = false
  renderWithProviders(
    <MachinePickerDialog
      mode='connect'
      onClose={() => {
        closed = true
      }}
    />,
    { connections: h.connections },
  )

  expect(screen.getByRole('button', { name: /Remote URL/ })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /Remote URL/ }))
  await userEvent.type(screen.getByLabelText('Server URL'), h.originB)
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))

  await waitFor(() => expect(closed).toBe(true))
  expect((await fetchSettings(undefined, h.clientA)).values['environments.machines']).toEqual({
    'localhost-37902': { kind: 'origin', url: h.originB },
  })
  await waitFor(() =>
    expect(h.connections.store.getState().machines).toEqual([
      expect.objectContaining({
        name: 'localhost-37902',
        environmentId: h.descriptorB.environmentId,
        phase: 'live',
      }),
    ]),
  )
})

test('offers another machine alongside existing choices and returns to the list on cancel', async () => {
  const connections = createTestEnvironmentConnections({
    existing: { kind: 'origin', url: 'http://localhost:37902' },
  })
  renderWithProviders(<MachinePickerDialog mode='connect' onClose={() => {}} />, { connections })
  expect(screen.getByRole('button', { name: /existing/ })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Add machine' }))
  expect(screen.getByLabelText('SSH target')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: /existing/ })).toBeVisible()
  expect(screen.queryByLabelText('Server URL')).toBeNull()
})

test('canceling the first machine closes without saving', async ({ client }) => {
  let closed = false
  renderWithProviders(
    <MachinePickerDialog
      mode='connect'
      onClose={() => {
        closed = true
      }}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: /Remote URL/ }))
  await userEvent.type(screen.getByLabelText('Server URL'), 'https://unfinished.example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(closed).toBe(true)
  expect((await fetchSettings(undefined, client)).values['environments.machines']).toEqual({})
})

test('offers SSH alongside Remote URL in the browser', async () => {
  renderWithProviders(<MachinePickerDialog mode='connect' onClose={() => {}} />)
  expect(screen.getByRole('button', { name: /^SSH/ })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('button', { name: /^SSH/ }))
  expect(screen.getByLabelText('SSH target')).toBeVisible()
  expect(screen.queryByLabelText('Repository path')).toBeNull()
  expect(screen.queryByLabelText('Remote server port')).toBeNull()
  expect(screen.queryByLabelText('Server URL')).toBeNull()
})

test('connects a host selected from SSH config and saves no repository path', async () => {
  const h = await createSshEnvironmentFixture()
  await writeSshConfig(h.serverA.root, 'Host fixture\n')
  await h.connections.disconnectMachine('remote')
  h.connections.configureMachines({})
  let closed = false
  renderWithProviders(
    <MachinePickerDialog
      mode='connect'
      onClose={() => {
        closed = true
      }}
    />,
    {
      connections: h.connections,
    },
  )
  await userEvent.click(await screen.findByRole('button', { name: 'fixture' }))
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(closed).toBe(true), { timeout: 5000 })
  expect((await fetchSettings(undefined, h.clientA)).values['environments.machines']).toEqual({
    fixture: { kind: 'ssh', target: 'fixture' },
  })
  expect(h.boundary.commands[0]?.at(-1)).toContain('platform-server --describe')
})

test('keeps a saved machine available for retry when the connection fails', async ({ server }) => {
  const h = await createFederationHarness(server)
  await h.connections.disconnectMachine('remote')
  h.connections.configureMachines({})
  httpServer.use(
    http.get('https://offline.example.test/health', () => new HttpResponse(null, { status: 503 })),
  )
  let closed = false
  renderWithProviders(
    <MachinePickerDialog
      mode='connect'
      onClose={() => {
        closed = true
      }}
    />,
    { connections: h.connections },
  )
  await userEvent.click(screen.getByRole('button', { name: /Remote URL/ }))
  await userEvent.type(screen.getByLabelText('Server URL'), 'https://offline.example.test')
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(closed).toBe(false)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
  expect(
    (await fetchSettings(undefined, h.clientA)).values['environments.machines'],
  ).toHaveProperty('offline-example-test')
  await userEvent.clear(screen.getByLabelText('Server URL'))
  await userEvent.click(screen.getByRole('button', { name: /Remote URL/ }))
  await userEvent.type(screen.getByLabelText('Server URL'), h.originB)
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await waitFor(() => expect(closed).toBe(true))
  expect((await fetchSettings(undefined, h.clientA)).values['environments.machines']).toEqual({
    'offline-example-test': { kind: 'origin', url: h.originB },
  })
})

test('an edited retry stays open until the replacement connection succeeds', async ({ server }) => {
  const h = await createFederationHarness(server)
  await h.connections.disconnectMachine('remote')
  h.connections.configureMachines({})
  httpServer.use(
    http.get(
      'https://first-offline.example.test/health',
      () => new HttpResponse(null, { status: 503 }),
    ),
    http.get('https://second-offline.example.test/health', async () => {
      await delay(200)
      return new HttpResponse(null, { status: 503 })
    }),
  )
  let closed = false
  renderWithProviders(
    <MachinePickerDialog
      mode='connect'
      onClose={() => {
        closed = true
      }}
    />,
    { connections: h.connections },
  )
  await userEvent.click(screen.getByRole('button', { name: /Remote URL/ }))
  await userEvent.type(screen.getByLabelText('Server URL'), 'https://first-offline.example.test')
  await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await screen.findByRole('alert')
  await userEvent.clear(screen.getByLabelText('Server URL'))
  await userEvent.click(screen.getByRole('button', { name: /Remote URL/ }))
  await userEvent.type(screen.getByLabelText('Server URL'), 'https://second-offline.example.test')
  const connectButton = screen.getByRole('button', { name: 'Connect' })
  await userEvent.click(connectButton)
  expect(connectButton).toBeDisabled()
  expect(closed).toBe(false)
  await screen.findByRole('alert')
  expect(closed).toBe(false)
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
})

test.for(['button', 'escape', 'unmount'] as const)(
  'canceling a pending SSH form with %s stops its launch and ignores the late result',
  async (action) => {
    const h = await createSshEnvironmentFixture()
    await h.connections.disconnectMachine('remote')
    h.connections.configureMachines({})
    let closed = false
    const view = renderWithProviders(
      <MachinePickerDialog
        mode='connect'
        onClose={() => {
          closed = true
        }}
      />,
      { connections: h.connections },
    )
    await userEvent.click(screen.getByRole('button', { name: /^SSH/ }))
    await userEvent.type(screen.getByLabelText('SSH target'), 'fixture')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(h.boundary.commands).toHaveLength(1))
    const pending = h.connections.connectMachine('fixture')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    if (action === 'button') await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    if (action === 'escape') await userEvent.keyboard('{Escape}')
    if (action === 'unmount') view.unmount()
    expect(screen.queryByLabelText('SSH target')).toBeNull()
    expect(await pending).toBe('cancelled')
    await h.children[0]!.exited
    expect(h.children[0]?.signalCode).not.toBeNull()
    expect(h.boundary.commands).toHaveLength(1)
    expect(closed).toBe(false)
    expect(h.connections.store.getState().machines[0]?.phase).toBe('idle')
  },
)
