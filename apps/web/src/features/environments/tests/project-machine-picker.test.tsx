import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished, vi } from 'vitest'

import { ProjectPicker } from '@/features/environments/components/project-picker'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { connectedMachines } from '@/lib/environments/utils/machines'
import { createFederationHarness } from '../../../../test/factories/federation'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test.for(['row', 'path'])(
  'picking a project on B by %s registers only on B before opening its root',
  async (selection, { server }) => {
    const h = await createFederationHarness(server)
    await mkdir(join(h.serverA.root, 'only-on-a'))
    await mkdir(join(h.serverB.root, 'only-on-b'))
    await waitFor(() =>
      expect(
        h.connections.store.getState().machines.find((machine) => machine.name === 'remote')?.phase,
      ).toBe('live'),
    )
    // The folder list is virtualized and mounts no rows while its scroll box measures zero.
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600)
    onTestFinished(() => height.mockRestore())
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
    if (selection === 'row') await userEvent.click(folder)
    if (selection === 'path') {
      await userEvent.click(screen.getByRole('button', { name: 'Go to folder' }))
      const path = screen.getByRole('textbox', { name: 'Folder path' })
      await userEvent.clear(path)
      await userEvent.type(path, join(h.serverB.root, 'only-on-b'))
      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Folder path' })).toBeNull())
      await screen.findByRole('button', { name: 'only-on-b' })
    }
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
  },
)
