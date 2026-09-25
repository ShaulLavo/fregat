import { act, render, screen } from '@testing-library/react'
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
      <ConnectionGate origin={origin}>
        <div>Cached workbench</div>
      </ConnectionGate>
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
