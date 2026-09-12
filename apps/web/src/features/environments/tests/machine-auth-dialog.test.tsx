import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { AuthDialog } from '@/features/environments/components/auth-dialog'
import {
  activeServerOrigin,
  environmentClientFor,
  primaryServerOrigin,
  setActiveServerOrigin,
  setClient,
} from '@/lib/client'
import { clientInstanceId } from '@/lib/instance-id'
import { createTestEnvironmentConnections } from '../../../../test/factories/environment-connections'
import { createSshEnvironmentFixture } from '../../../../test/factories/ssh-environment'
import { saveSettings } from '@/features/settings/utils/api'
import { readConnectedMachines } from '@/state/connected-machines'
import { createObservedInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import { makeTestServer } from '../../../../test/server'
import { createInProcessClient } from '../../../../test/client'
import { installTestEnvironment } from '../../../../test/factories/client-binding'

test('SSH authentication masks and clears the secret while submitting only to the primary backend', async ({
  server,
}) => {
  const requests: Request[] = []
  const origin = activeServerOrigin()
  const primary = environmentClientFor(primaryServerOrigin())
  setActiveServerOrigin(primaryServerOrigin())
  setClient(
    createObservedInProcessClient(server, (request) => {
      requests.push(request.clone())
    }),
  )
  const remote = await makeTestServer({ filesystemWatch: false })
  const restoreEnvironment = await installTestEnvironment(
    'https://other-environment.example.test',
    createInProcessClient(remote),
  )
  onTestFinished(async () => {
    restoreEnvironment()
    setActiveServerOrigin(primaryServerOrigin())
    setClient(primary)
    setActiveServerOrigin(origin)
    await remote.cleanup()
  })
  const connections = createTestEnvironmentConnections()
  connections.authStore.setState({
    prompt: { id: 'expired-prompt', name: 'remote', kind: 'secret', prompt: 'Password:' },
  })
  renderWithProviders(<AuthDialog />, { connections })
  const field = screen.getByLabelText('Password:')
  expect(field).toHaveAttribute('type', 'password')
  await userEvent.type(field, 'private-test-response')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not submit the SSH response. Try again.',
    ),
  )
  expect(field).toHaveValue('')
  const request = requests.find((entry) => new URL(entry.url).pathname === '/machines/remote/auth')
  expect(request?.headers.get('x-client-instance')).toBe(clientInstanceId())
  expect(await request?.json()).toEqual({ id: 'expired-prompt', response: 'private-test-response' })
  expect(Object.values(localStorage)).not.toContain('private-test-response')
  act(() => connections.authStore.setState({ prompt: null }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('SSH host confirmation shows the fingerprint and sends null when canceled', async ({
  server,
}) => {
  const responses: unknown[] = []
  const origin = activeServerOrigin()
  const primary = environmentClientFor(primaryServerOrigin())
  setActiveServerOrigin(primaryServerOrigin())
  setClient(
    createObservedInProcessClient(server, async (request) => {
      if (new URL(request.url).pathname.endsWith('/auth'))
        responses.push(await request.clone().json())
    }),
  )
  onTestFinished(() => {
    setActiveServerOrigin(primaryServerOrigin())
    setClient(primary)
    setActiveServerOrigin(origin)
  })
  const connections = createTestEnvironmentConnections()
  connections.authStore.setState({
    prompt: {
      id: 'host-prompt',
      name: 'remote',
      kind: 'confirmation',
      prompt: 'ED25519 fingerprint SHA256:fixture',
    },
  })
  renderWithProviders(<AuthDialog />, { connections })
  expect(screen.getByText('ED25519 fingerprint SHA256:fixture')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Trust and connect' })).toBeEnabled()
  expect(screen.queryByRole('textbox')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(responses).toEqual([{ id: 'host-prompt', response: null }]))
})

test.for(['button', 'escape'] as const)(
  'dismisses an expired authentication prompt with %s even when the backend rejects cancellation',
  async (action) => {
    const connections = createTestEnvironmentConnections()
    connections.authStore.setState({
      prompt: { id: 'expired', name: 'remote', kind: 'secret', prompt: 'Password:' },
    })
    renderWithProviders(<AuthDialog />, { connections })
    if (action === 'button') await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    if (action === 'escape') await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(connections.authStore.getState()).toEqual({ prompt: null, pending: false, error: null })
  },
)

test('authentication remains cancelable while its response request is pending', async ({
  server,
}) => {
  let complete = () => {}
  let responseStarted = false
  const blocked = new Promise<void>((resolve) => {
    complete = resolve
  })
  const primary = environmentClientFor(primaryServerOrigin())
  setClient(
    createObservedInProcessClient(server, async (request) => {
      if (!new URL(request.url).pathname.endsWith('/auth')) return
      if ((await request.clone().json()).response === null) return
      responseStarted = true
      await blocked
    }),
  )
  onTestFinished(() => {
    complete()
    setClient(primary)
  })
  const connections = createTestEnvironmentConnections()
  connections.authStore.setState({
    prompt: { id: 'expired', name: 'remote', kind: 'secret', prompt: 'Password:' },
  })
  renderWithProviders(<AuthDialog />, { connections })
  await userEvent.type(screen.getByLabelText('Password:'), 'private-test-response')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(responseStarted).toBe(true))
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  complete()
  await waitFor(() =>
    expect(connections.authStore.getState()).toEqual({ prompt: null, pending: false, error: null }),
  )
})

test('canceling authentication stops the pending SSH connection and removes automatic recovery', async () => {
  const h = await createSshEnvironmentFixture()
  const machine = { kind: 'ssh', target: 'fixture' } as const
  await saveSettings(
    {
      mutationId: 'auth-cancel-ssh',
      target: 'user',
      operations: [{ kind: 'machine.set', name: 'remote', machine }],
    },
    h.clientA,
  )
  h.connections.configureMachines({ remote: machine })
  await waitFor(() => expect(h.boundary.commands).toHaveLength(1))
  const pending = h.connections.connectMachine('remote')
  h.connections.authStore.setState({
    prompt: { id: 'expired', name: 'remote', kind: 'secret', prompt: 'Password:' },
  })
  renderWithProviders(<AuthDialog />, { connections: h.connections })
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(await pending).toBe('cancelled')
  await h.children[0]!.exited
  expect(h.children[0]?.signalCode).not.toBeNull()
  expect(readConnectedMachines()).not.toContain('remote')
  window.dispatchEvent(new Event('focus'))
  expect(h.boundary.commands).toHaveLength(1)
})
