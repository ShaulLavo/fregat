import userEvent from '@testing-library/user-event'
import { onTestFinished, vi } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import * as v from 'valibot'
import { environmentIdSchema, healthDescriptorSchema } from '@workspace/contracts'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { ConnectionGate } from '@/features/environments/components/connection-gate'
import { PickerDialog } from '@/features/environments/components/picker-dialog'
import { MachineConnectionRows } from '@/features/chat-mode/components/machine-connection-rows'
import { MachineRow } from '@/features/settings/components/machine-row'
import { transportFor } from '@/features/chat/state/active-transports'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { primaryServerOrigin } from '@/lib/client'
import { recordEnvironmentCacheBinding } from '@/lib/environments/state/binding-cache'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import {
  environmentScopedStorage,
  globalChromeStorage,
} from '@/lib/environments/state/scoped-storage'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { writeConnectedMachines } from '@/state/connected-machines'
import { createBootstrap } from '@/state/bootstrap'
import { createTestNavigation } from '../../../../test/factories/navigation'
import { createFederationHarness } from '../../../../test/factories/federation'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'
import type { TestServer } from '../../../../test/server'
import type { createInProcessClient } from '../../../../test/client'

test('a replaced primary database is adopted without user action', async ({ client }) => {
  const replacedId = v.parse(environmentIdSchema, crypto.randomUUID())
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const origin = primaryServerOrigin()
  const previous = useEnvironmentsStore.getState()
  const freshPage = () =>
    useEnvironmentsStore.setState({
      activeOrigin: origin,
      entries: { [origin]: createEnvironmentEntry(origin, origin) },
      connectionByOrigin: {},
    })
  const staleProfile = () => {
    recordEnvironmentCacheBinding(environmentScopedStorage(replacedId), {
      names: ['local'],
      origin,
      descriptor: { ...descriptor, environmentId: replacedId },
    })
    environmentScopedStorage(replacedId).setItem('platform.chat.drafts.v1', '{}')
    freshPage()
  }
  staleProfile()
  const reload = vi.fn()
  const navigation = createTestNavigation()
  const boot = createBootstrap(navigation, { reload })
  let reloaded: ReturnType<typeof createBootstrap> | null = null
  const reloadedNavigation = createTestNavigation()
  try {
    boot.start()
    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(globalChromeStorage.keys(`env:${replacedId}|`)).toEqual([])
    boot.dispose()

    freshPage()
    const nextReload = vi.fn()
    reloaded = createBootstrap(reloadedNavigation, { reload: nextReload })
    reloaded.start()
    await waitFor(() => expect(reloaded?.getState().application).not.toBeNull())
    expect(reloaded.getState().error).toBeNull()
    expect(useEnvironmentsStore.getState().entries[origin]?.environmentId).toBe(
      descriptor.environmentId,
    )
    expect(selectServerConnection(useEnvironmentsStore.getState(), origin).phase).not.toBe(
      'identity-drift',
    )
    expect(nextReload).not.toHaveBeenCalled()
    reloaded.dispose()

    // The same replacement twice in one tab is a disagreeing server; the tab stops reloading.
    staleProfile()
    const repeatedReload = vi.fn()
    reloaded = createBootstrap(reloadedNavigation, { reload: repeatedReload })
    reloaded.start()
    await waitFor(() =>
      expect(selectServerConnection(useEnvironmentsStore.getState(), origin).phase).toBe(
        'identity-drift',
      ),
    )
    expect(repeatedReload).not.toHaveBeenCalled()
  } finally {
    boot.dispose()
    reloaded?.dispose()
    navigation.dispose()
    reloadedNavigation.dispose()
    useEnvironmentsStore.setState(previous, true)
    localStorage.clear()
    sessionStorage.clear()
  }
})

/** A remote machine this browser remembers under an identity its server no longer has. */
async function driftedRemote(server: TestServer, client: ReturnType<typeof createInProcessClient>) {
  const replacedId = v.parse(environmentIdSchema, crypto.randomUUID())
  const remoteDescriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  recordEnvironmentCacheBinding(environmentScopedStorage(replacedId), {
    names: ['remote'],
    origin: 'http://localhost:37902',
    descriptor: { ...remoteDescriptor, environmentId: replacedId },
  })
  writeConnectedMachines(new Set(['remote']))
  const h = await createFederationHarness(server)
  onTestFinished(() => localStorage.clear())
  return { h, replacedId }
}

async function expectTrusted(
  h: Awaited<ReturnType<typeof createFederationHarness>>,
  replacedId: string,
) {
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('live'),
  )
  expect(useEnvironmentsStore.getState().entries[h.originB]?.environmentId).toBe(
    h.descriptorB.environmentId,
  )
  expect(transportFor(h.descriptorB.environmentId)?.closed).toBe(false)
  expect(globalChromeStorage.keys(`env:${replacedId}|`)).toEqual([])
}

test('a replaced remote database shows the gate, and Trust replacement connects to it', async ({
  server,
  client,
}) => {
  const { h, replacedId } = await driftedRemote(server, client)
  const view = render(
    <QueryClientProvider client={queryClientFor(h.originB)}>
      <EnvironmentConnectionsContext value={h.connections}>
        <ConnectionGate origin={h.originB}>
          <div>Remote workbench</div>
        </ConnectionGate>
      </EnvironmentConnectionsContext>
    </QueryClientProvider>,
  )
  try {
    const trust = await screen.findByRole('button', { name: 'Trust replacement' })
    expect(screen.queryByText('Remote workbench')).toBeNull()
    expect(screen.getByText(/Trust replacement connects to the new database/)).toBeVisible()
    await userEvent.click(trust)
    await screen.findByText('Remote workbench')
    await expectTrusted(h, replacedId)
  } finally {
    view.unmount()
  }
})

test('the rail notice for a replaced remote offers Trust replacement in place of Retry', async ({
  server,
  client,
}) => {
  const { h, replacedId } = await driftedRemote(server, client)
  useEnvironmentsStore.setState({ activeOrigin: h.originB })
  renderWithProviders(<MachineConnectionRows />, { connections: h.connections })
  expect(await screen.findByText('Remote fixture · Machine identity changed')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Trust replacement' }))
  await expectTrusted(h, replacedId)
})

test('the settings row for a replaced remote offers Trust replacement in place of Retry now', async ({
  server,
  client,
}) => {
  const { h, replacedId } = await driftedRemote(server, client)
  renderWithProviders(
    <MachineRow
      name='remote'
      machine={{ kind: 'origin', url: h.originB, label: 'Remote fixture' }}
      disabled={false}
    />,
    { connections: h.connections },
  )
  expect(await screen.findByText('Machine identity changed')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Trust replacement' }))
  await expectTrusted(h, replacedId)
})

test('the connect picker offers Trust replacement for a replaced remote and closes once it is live', async ({
  server,
  client,
}) => {
  const { h, replacedId } = await driftedRemote(server, client)
  const onClose = vi.fn()
  renderWithProviders(<PickerDialog mode='connect' onClose={onClose} />, {
    connections: h.connections,
  })
  expect(await screen.findByText('Machine identity changed')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Trust replacement' }))
  await expectTrusted(h, replacedId)
  expect(onClose).toHaveBeenCalledOnce()
})
