import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { http, HttpResponse } from 'msw'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { server as externalHttp } from '../../../../../test/msw/server'
import {
  createConnectionNoticeFixture,
  MACHINE_SETUP_ERROR,
} from '../../../../../test/factories/connection-notice'
import { createFederationHarness } from '../../../../../test/factories/federation'
import { MachineConnectionRows } from '@/features/chat-mode/components/machine-connection-rows'
import { MachineRow } from '@/features/settings/components/machine-row'

test('background failures stay in machine management, with diagnostics behind Details', async () => {
  const fixture = createConnectionNoticeFixture()
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
  const fixture = createConnectionNoticeFixture()
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

test('explicit retry re-arms a dismissed incident and runs the real connection command', async () => {
  const fixture = createConnectionNoticeFixture()
  onTestFinished(fixture.dispose)
  fixture.selectRemote()
  let requests = 0
  externalHttp.use(
    http.get(`${fixture.remote}/health`, () => {
      requests += 1
      return HttpResponse.json({ message: 'Machine still unavailable.' }, { status: 503 })
    }),
  )
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
