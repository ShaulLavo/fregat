import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { createClientError } from '@workspace/client-core/errors'
import { ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import { saveSettings } from '@/features/settings/utils/api'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import {
  createConnectionNoticeFixture,
  MACHINE_PROTOCOL_ERROR,
  MACHINE_SETUP_ERROR,
} from '../../../../../test/factories/connection-notice'
import { createFederationHarness } from '../../../../../test/factories/federation'
import { createSshEnvironmentFixture } from '../../../../../test/factories/ssh-environment'
import { MachineConnectionRows } from '@/features/chat-mode/components/machine-connection-rows'
import { MachineRow } from '@/features/settings/components/machine-row'

test('background failures stay in machine management, with diagnostics behind Details', async () => {
  const fixture = await createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  const rail = renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  expect(rail.container).not.toHaveTextContent('shaul-mac')
  expect(rail.container).not.toHaveTextContent('server:install')
  rail.unmount()
  renderWithProviders(
    <MachineRow
      name='shaul-mac'
      machine={{ kind: 'origin', url: fixture.remote }}
      disabled={false}
    />,
    { connections: fixture.connections },
  )
  expect(screen.getByText('Server setup needed')).toBeVisible()
  expect(screen.queryByText(MACHINE_SETUP_ERROR.message)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'shaul-mac connection details' }))
  expect(screen.getByText(MACHINE_SETUP_ERROR.message)).toBeVisible()
  expect(screen.getByText(MACHINE_SETUP_ERROR.fix)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Retry now' })).toBeEnabled()
})

test('active notices are concise and dismissal survives repeat updates and remounts', async () => {
  const fixture = await createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  fixture.selectRemote()
  const rail = renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  expect(screen.getByText('shaul-mac · Server setup needed')).toBeVisible()
  expect(screen.queryByText(MACHINE_SETUP_ERROR.message)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss shaul-mac connection notice' }))
  act(() => fixture.update({ lastErrorAt: 200 }))
  expect(screen.queryByText('shaul-mac · Server setup needed')).toBeNull()
  act(() => fixture.update({ phase: 'reconnecting', lastError: null }))
  expect(screen.queryByText('shaul-mac · Reconnecting…')).toBeNull()
  act(() =>
    fixture.update({ phase: 'blocked', lastError: { ...MACHINE_SETUP_ERROR }, lastErrorAt: 300 }),
  )
  rail.unmount()
  renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  expect(screen.queryByText('shaul-mac · Server setup needed')).toBeNull()
  act(() =>
    fixture.update({
      phase: 'identity-drift',
      lastError: { code: 'machines.SSH_IDENTITY', message: 'The machine identity changed.' },
    }),
  )
  expect(screen.getByText('shaul-mac · Machine identity changed')).toBeVisible()
})

test('a server on another protocol reads as out of date, and Details shows its fix', async () => {
  const fixture = await createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  fixture.update({
    config: { kind: 'ssh', target: 'shaul-mac' },
    lastError: MACHINE_PROTOCOL_ERROR,
  })
  fixture.selectRemote()
  const rail = renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  expect(screen.getByText('shaul-mac · Server out of date')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'shaul-mac connection details' }))
  expect(screen.getByText(MACHINE_PROTOCOL_ERROR.message)).toBeVisible()
  expect(screen.getByText(MACHINE_PROTOCOL_ERROR.fix)).toBeVisible()
  rail.unmount()
  renderWithProviders(
    <MachineRow name='shaul-mac' machine={{ kind: 'ssh', target: 'shaul-mac' }} disabled={false} />,
    { connections: fixture.connections },
  )
  expect(screen.getByText('Server out of date')).toBeVisible()
})

test('a real SSH server on an older protocol ends blocked with its fix, and focus does not retry it', async () => {
  const running = ORCHESTRATION_WS_PROTOCOL_VERSION - 1
  const h = await createSshEnvironmentFixture({ descriptor: { protocolVersion: running } })
  const machine = { kind: 'ssh', target: 'fixture' } as const
  await saveSettings(
    {
      mutationId: 'protocol-ssh',
      target: 'user',
      operations: [{ kind: 'machine.set', name: 'remote', machine }],
    },
    h.clientA,
  )
  const remote = () =>
    h.connections.store.getState().machines.find((entry) => entry.name === 'remote')
  // The event stream re-reports blocked, so only the trace shows the connect result's own phase.
  const phases: string[] = []
  const unsubscribe = h.connections.store.subscribe(() => {
    const phase = remote()?.phase
    if (phase && phases.at(-1) !== phase) phases.push(phase)
  })
  onTestFinished(unsubscribe)
  h.connections.configureMachines({ remote: machine })
  expect(await h.connections.connectMachine('remote')).toBe('failed')
  expect(phases).not.toContain('offline')
  expect(remote()).toMatchObject({
    phase: 'blocked',
    lastError: {
      code: 'machines.SSH_PROTOCOL',
      message: `The remote server speaks protocol ${running}, and this Platform needs protocol ${ORCHESTRATION_WS_PROTOCOL_VERSION}.`,
      fix: "Update the Platform checkout at /work/space ' $(touch unwanted) to this server’s version, run bun install there, then Retry.",
    },
  })
  const commands = h.boundary.commands.length
  window.dispatchEvent(new Event('focus'))
  window.dispatchEvent(new Event('online'))
  expect(remote()?.phase).toBe('blocked')
  expect(h.boundary.commands).toHaveLength(commands)
  renderWithProviders(<MachineRow name='remote' machine={machine} disabled={false} />, {
    connections: h.connections,
  })
  expect(screen.getByText('Server out of date')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'remote connection details' }))
  expect(screen.getByText(remote()!.lastError!.fix!)).toBeVisible()
})

test('browser SSH notices allow reconnecting a retained machine', async () => {
  const fixture = await createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  fixture.update({
    config: { kind: 'ssh', target: 'shaul-mac' },
    phase: 'idle',
    lastError: null,
  })
  fixture.selectRemote()
  renderWithProviders(<MachineConnectionRows />, {
    connections: fixture.connections,
  })
  expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled()
})

test('explicit retry re-arms a dismissed incident and runs the real connection command', async () => {
  let requests = 0
  let unavailable = false
  const fixture = await createConnectionNoticeFixture((request) => {
    if (!unavailable || new URL(request.url).pathname !== '/health') return
    requests += 1
    throw createClientError({
      message: 'Machine still unavailable.',
      code: 'TEST_MACHINE_UNAVAILABLE',
      status: 503,
      why: 'The remote HTTP boundary is unavailable for this retry test.',
      fix: 'Restore the test connection.',
    })
  })
  onTestFinished(fixture.dispose)
  fixture.selectRemote()
  unavailable = true
  fixture.connections.start()
  renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss shaul-mac connection notice' }))
  await act(() => fixture.connections.retryMachine('shaul-mac'))
  expect(requests).toBe(1)
  const dismiss = screen.getByRole('button', { name: 'Dismiss shaul-mac connection notice' })
  expect(dismiss).toBeVisible()
  await userEvent.click(within(dismiss.parentElement!).getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(requests).toBe(2))
})

test('a recovered real connection clears dismissal for its next outage', async ({ server }) => {
  const fixture = await createFederationHarness(server)
  fixture.cutConnection(fixture.originB)
  await waitFor(() =>
    expect(
      fixture.connections.store.getState().machines.find((machine) => machine.name === 'remote')
        ?.phase,
    ).not.toBe('live'),
  )
  fixture.connections.notices.dismiss('machine:remote', {
    code: 'CONNECTION_FAILED',
    message: 'Lost connection',
  })
  fixture.restoreConnection(fixture.originB)
  await waitFor(() =>
    expect(
      fixture.connections.store.getState().machines.find((machine) => machine.name === 'remote')
        ?.phase,
    ).toBe('live'),
  )
  expect(fixture.connections.notices.store.getState().dismissed).not.toHaveProperty(
    'machine:remote',
  )
})
