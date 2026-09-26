import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vitest'
import { ProjectMenu } from '@/features/chat-mode/components/project-menu'
import { ProjectDeleteDialog } from '@/features/chat-mode/components/project-delete-dialog'
import { useProjectDeleteRequestStore } from '@/features/chat-mode/state/project-delete-request-store'
import { currentRailEnvironments } from '@/features/chat-mode/state/rail-environments'
import { sessionRailModel } from '@workspace/client-core/chat/rail/model'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../../test/factories/federation'
import { renderWithProviders } from '../../../../../test/render'
import { expect, test } from '../../../../../test/fixtures'
import { holdToConfirm } from '../../../../../test/hold'

for (const filtered of [false, true]) {
  test(`archive and delete preview retain ${filtered ? 'filtered' : 'all'} real owners sharing a project ID`, async ({
    server,
  }) => {
    const h = await createFederationHarness(server)
    const first = await registerFederatedProject(h.serverA, h.clientA, 'first')
    const second = await registerFederatedProject(h.serverB, h.clientB, 'second')
    expect(first.projectId).toBe(second.projectId)
    await waitFor(() =>
      expect(currentRailEnvironments().flatMap((environment) => environment.sessions)).toHaveLength(
        2,
      ),
    )
    const group = sessionRailModel({
      environments: currentRailEnvironments(),
      machineFilter: filtered ? h.descriptorB.environmentId : null,
    }).groups[0]!
    expect(group.project.members).toHaveLength(filtered ? 1 : 2)
    useProjectDeleteRequestStore.getState().dismissDelete()
    onTestFinished(() => useProjectDeleteRequestStore.getState().dismissDelete())
    renderWithProviders(
      <>
        <ProjectMenu group={group} trigger={<button>Project actions</button>} />
        <ProjectDeleteDialog />
      </>,
      {
        application: h.application,
        queryClient: h.application.getSnapshot().queryClient,
      },
    )
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Project actions' }),
    })
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete Project' }))
    const request = useProjectDeleteRequestStore.getState().request!
    expect(request.members.map((member) => member.ref.environmentId).sort()).toEqual(
      (filtered
        ? [h.descriptorB.environmentId]
        : [h.descriptorA.environmentId, h.descriptorB.environmentId]
      ).sort(),
    )
    expect(request.sessionCount).toBe(filtered ? 1 : 2)
    expect((await h.clientA.orchestration['shell-snapshot'].get()).data!.projects).toHaveLength(1)
    expect((await h.clientB.orchestration['shell-snapshot'].get()).data!.projects).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Project actions' }),
    })
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive All Sessions' }))
    await waitFor(async () => {
      const local = (await h.clientA.orchestration['shell-snapshot'].get()).data!.sessions[0]!
      const remote = (await h.clientB.orchestration['shell-snapshot'].get()).data!.sessions[0]!
      expect(Boolean(local.archivedAt)).toBe(!filtered)
      expect(Boolean(remote.archivedAt)).toBe(true)
    })
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: screen.getByRole('button', { name: 'Project actions' }),
    })
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete Project' }))
    holdToConfirm(screen.getByRole('button', { name: /^Delete$/ }))
    await waitFor(async () => {
      expect((await h.clientA.orchestration['shell-snapshot'].get()).data!.projects).toHaveLength(
        filtered ? 1 : 0,
      )
      expect((await h.clientB.orchestration['shell-snapshot'].get()).data!.projects).toHaveLength(0)
    })
  })
}

test('a disconnected owner remains visible and prevents an incomplete group deletion', async ({
  server,
}) => {
  const h = await createFederationHarness(server)
  await registerFederatedProject(h.serverA, h.clientA, 'first')
  await registerFederatedProject(h.serverB, h.clientB, 'second')
  await waitFor(() =>
    expect(currentRailEnvironments().flatMap((environment) => environment.sessions)).toHaveLength(
      2,
    ),
  )
  h.cutConnection(h.originB)
  await waitFor(() =>
    expect(
      currentRailEnvironments().find(
        (environment) => environment.environmentId === h.descriptorB.environmentId,
      )?.phase,
    ).not.toBe('live'),
  )
  const group = sessionRailModel({ environments: currentRailEnvironments() }).groups[0]!
  useProjectDeleteRequestStore.getState().dismissDelete()
  onTestFinished(() => useProjectDeleteRequestStore.getState().dismissDelete())
  renderWithProviders(
    <>
      <ProjectMenu group={group} trigger={<button>Project actions</button>} />
      <ProjectDeleteDialog />
    </>,
    {
      application: h.application,
      queryClient: h.application.getSnapshot().queryClient,
    },
  )
  await userEvent.pointer({
    keys: '[MouseRight]',
    target: screen.getByRole('button', { name: 'Project actions' }),
  })
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete Project' }))
  expect(useProjectDeleteRequestStore.getState().request?.members).toHaveLength(2)
  expect(screen.getByText(/Unavailable/)).toBeVisible()
  expect(screen.getByRole('button', { name: /^Delete$/ })).toBeDisabled()
  expect((await h.clientA.orchestration['shell-snapshot'].get()).data!.projects).toHaveLength(1)
  expect((await h.clientB.orchestration['shell-snapshot'].get()).data!.projects).toHaveLength(1)
})
