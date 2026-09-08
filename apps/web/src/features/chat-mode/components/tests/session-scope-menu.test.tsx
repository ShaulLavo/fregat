import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SessionMachineMenu } from '@/features/chat-mode/components/session-machine-menu'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../../test/factories/federation'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('the machine menu filters the federated rail and keeps project actions owned by that machine', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  const user = userEvent.setup()
  await registerFederatedProject(h.serverA, h.clientA, 'A')
  await registerFederatedProject(h.serverB, h.clientB, 'B')
  await waitFor(() =>
    expect(sessionRailModel({ environments: currentRailEnvironments() }).sessions).toHaveLength(2),
  )
  renderWithProviders(<SessionMachineMenu />, {
    queryClient: queryClientFor(h.originA),
    connections: h.connections,
  })
  try {
    screen.getByRole('button', { name: 'Filter machines' }).focus()
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('menuitemradio', { name: /Remote fixture/ }))
    const machineFilter = useSessionRailStore.getState().machineFilter
    expect(machineFilter).toBe(h.descriptorB.environmentId)
    const filtered = sessionRailModel({ environments: currentRailEnvironments(), machineFilter })
    expect(filtered.sessions.map((session) => session.title)).toEqual(['Session B'])
    expect(filtered.projects[0]?.ref.environmentId).toBe(h.descriptorB.environmentId)
    await user.click(await screen.findByRole('menuitemradio', { name: 'All machines' }))
    expect(useSessionRailStore.getState().machineFilter).toBeNull()
    act(() => h.connections.configureMachines({}))
    expect(screen.queryByRole('button', { name: 'Filter machines' })).toBeNull()
  } finally {
    useSessionRailStore.getState().setMachineFilter(null)
  }
})
