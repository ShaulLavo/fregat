import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ProjectPicker } from '@/features/environments/components/project-picker'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { connectedMachines } from '@/lib/environments/utils/machines'
import { createFederationHarness } from '../../../../test/factories/federation'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('picking a project on B lists B folders and registers only on B before opening its root', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await mkdir(join(h.serverA.root, 'only-on-a'))
  await mkdir(join(h.serverB.root, 'only-on-b'))
  await waitFor(() =>
    expect(
      h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
    ).toBe('live'),
  )
  renderWithProviders(
    <ProjectPicker
      machines={connectedMachines(useEnvironmentsStore.getState().entries)}
      onClose={() => {}}
    />,
    {
      application: h.application,
      connections: h.connections,
      queryClient: queryClientFor(h.originA),
    },
  )
  await userEvent.click(screen.getByRole('button', { name: /Remote fixture/ }))
  const folder = await screen.findByRole('option', { name: /only-on-b/ })
  expect(screen.queryByRole('option', { name: /only-on-a/ })).toBeNull()
  await userEvent.click(folder)
  await userEvent.click(screen.getByRole('button', { name: 'Choose folder' }))
  await waitFor(() => expect(h.application.getSnapshot().origin).toBe(h.originB))
  await waitFor(() =>
    expect(h.application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path).toBe(
      'only-on-b',
    ),
  )
  await waitFor(() =>
    expect(
      useChatProjectionStore.getState().slices[h.descriptorB.environmentId]?.projectIds,
    ).toHaveLength(1),
  )
  expect(
    useChatProjectionStore.getState().slices[h.descriptorA.environmentId]?.projectIds,
  ).toHaveLength(0)
})
