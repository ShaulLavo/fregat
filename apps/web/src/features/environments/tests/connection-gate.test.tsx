import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { createEnvironmentConnections } from '@/state/environment-connections'
import { EnvironmentConnectionsContext } from '@/providers/environment-connections-context'
import { orchestrationServerConfig } from '@workspace/client-core/test/orchestration-server-config'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import * as v from 'valibot'
import { healthDescriptorSchema } from '@workspace/contracts'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { ConnectionGate } from '@/features/environments/components/connection-gate'
import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { expect, test } from '../../../../test/fixtures'

test('fresh protocol refusal takes precedence over a known cached workbench', async ({
  client,
}) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const origin = primaryServerOrigin()
  const previous = useEnvironmentsStore.getState()
  const queryClient = primaryQueryClient()
  useEnvironmentsStore.setState({
    activeOrigin: origin,
    entries: { [origin]: createEnvironmentEntry(origin, origin) },
    connectionByOrigin: {},
  })
  useEnvironmentsStore.getState().restoreDescriptor(origin, descriptor)
  queryClient.setQueryData(environmentQueryKeys.descriptor, descriptor)
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EnvironmentConnectionsContext value={createEnvironmentConnections()}>
        <ConnectionGate origin={origin}>
          <div>Cached workbench</div>
        </ConnectionGate>
      </EnvironmentConnectionsContext>
    </QueryClientProvider>,
  )
  try {
    expect(screen.getByText('Cached workbench')).toBeVisible()
    act(() => {
      expect(() =>
        useEnvironmentsStore.getState().recordDescriptor(origin, {
          ...descriptor,
          protocolVersion: descriptor.protocolVersion - 1,
        }),
      ).toThrow('speaks protocol')
    })
    expect(screen.queryByText('Cached workbench')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeVisible()
  } finally {
    view.unmount()
    useEnvironmentsStore.setState(previous, true)
  }
})

test.for(['protocol', 'identity'] as const)(
  'retains an admitted workbench after a later %s refusal',
  async (kind, { client }) => {
    const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
    const origin = primaryServerOrigin()
    const previous = useEnvironmentsStore.getState()
    const queryClient = primaryQueryClient()
    useEnvironmentsStore.setState({
      entries: { [origin]: createEnvironmentEntry(origin, origin) },
      connectionByOrigin: {},
    })
    useEnvironmentsStore.getState().recordDescriptor(origin, descriptor)
    useEnvironmentsStore
      .getState()
      .recordHandshake(
        origin,
        orchestrationServerConfig({ environmentId: descriptor.environmentId }),
      )
    queryClient.setQueryData(environmentQueryKeys.descriptor, descriptor)
    const view = render(
      <QueryClientProvider client={queryClient}>
        <EnvironmentConnectionsContext value={createEnvironmentConnections()}>
          <ConnectionGate origin={origin}>
            <input aria-label='Live terminal input' defaultValue='retained input' />
          </ConnectionGate>
        </EnvironmentConnectionsContext>
      </QueryClientProvider>,
    )
    try {
      const terminal = screen.getByRole('textbox', { name: 'Live terminal input' })
      act(() => {
        const next =
          kind === 'protocol'
            ? { ...descriptor, protocolVersion: descriptor.protocolVersion + 1 }
            : {
                ...descriptor,
                environmentId: v.parse(healthDescriptorSchema, {
                  ...descriptor,
                  environmentId: crypto.randomUUID(),
                }).environmentId,
              }
        expect(() => useEnvironmentsStore.getState().recordDescriptor(origin, next)).toThrow()
      })
      expect(screen.getByRole('textbox', { name: 'Live terminal input' })).toBe(terminal)
      expect(terminal).toHaveValue('retained input')
    } finally {
      view.unmount()
      useEnvironmentsStore.setState(previous, true)
    }
  },
)

test('gate Retry restarts the primary transport after a blocked startup', async ({ client }) => {
  const descriptor = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const origin = primaryServerOrigin()
  const previous = useEnvironmentsStore.getState()
  const queryClient = primaryQueryClient()
  useEnvironmentsStore.setState({
    entries: { [origin]: createEnvironmentEntry(origin, origin) },
    connectionByOrigin: {},
  })
  useEnvironmentsStore.getState().restoreDescriptor(origin, descriptor)
  expect(() =>
    useEnvironmentsStore
      .getState()
      .recordDescriptor(origin, { ...descriptor, protocolVersion: descriptor.protocolVersion + 1 }),
  ).toThrow()
  queryClient.setQueryData(environmentQueryKeys.descriptor, descriptor)
  const connections = createEnvironmentConnections()
  const retry = vi.spyOn(connections, 'retryPrimary').mockResolvedValue()
  const view = render(
    <QueryClientProvider client={queryClient}>
      <EnvironmentConnectionsContext value={connections}>
        <ConnectionGate origin={origin}>
          <div>Recovered</div>
        </ConnectionGate>
      </EnvironmentConnectionsContext>
    </QueryClientProvider>,
  )
  try {
    await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }))
    await waitFor(() => expect(retry).toHaveBeenCalledOnce())
  } finally {
    view.unmount()
    useEnvironmentsStore.setState(previous, true)
  }
})
