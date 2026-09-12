import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { createClientError } from '@workspace/client-core/errors'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import {
  createConnectionNoticeFixture,
  MACHINE_SETUP_ERROR,
} from '../../../../../test/factories/connection-notice'
import { createFederationHarness } from '../../../../../test/factories/federation'
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
  expect(screen.queryByText(MACHINE_SETUP_ERROR)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'shaul-mac connection details' }))
  expect(screen.getByText(MACHINE_SETUP_ERROR)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Retry now' })).toBeEnabled()
})

test('active notices are concise and dismissal survives repeat updates and remounts', async () => {
  const fixture = await createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  fixture.selectRemote()
  const rail = renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  expect(screen.getByText('shaul-mac · Server setup needed')).toBeVisible()
  expect(screen.queryByText(MACHINE_SETUP_ERROR)).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss shaul-mac connection notice' }))
  act(() => fixture.update({ lastErrorAt: 200 }))
  expect(screen.queryByText('shaul-mac · Server setup needed')).toBeNull()
  act(() => fixture.update({ phase: 'reconnecting', lastError: null }))
  expect(screen.queryByText('shaul-mac · Reconnecting…')).toBeNull()
  act(() => fixture.update({ phase: 'blocked', lastError: MACHINE_SETUP_ERROR, lastErrorAt: 300 }))
  rail.unmount()
  renderWithProviders(<MachineConnectionRows />, { connections: fixture.connections })
  expect(screen.queryByText('shaul-mac · Server setup needed')).toBeNull()
  act(() => fixture.update({ phase: 'identity-drift', lastError: 'The machine identity changed.' }))
  expect(screen.getByText('shaul-mac · Machine identity changed')).toBeVisible()
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
  expect(screen.getByRole('button', { name: 'Dismiss shaul-mac connection notice' })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
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
  fixture.connections.notices.dismiss('machine:remote', 'Lost connection')
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
