import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createFederationHarness,
  registerFederatedProject,
} from '../../../../test/factories/federation'
import { saveSettings } from '@/features/settings/utils/api'
import { deriveProjectGroupKey } from '@workspace/client-core/chat/rail/project-grouping'
import { providerInstanceIdSchema, type ProjectId } from '@workspace/contracts'
import * as v from 'valibot'

import { getClient } from '@/lib/client'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { fetchSettings } from '@/features/settings/utils/api'
import { ProjectSection } from '@/features/settings/components/project-section'
import { renderWithProviders } from '../../../../test/render'
import { expect, test } from '../../../../test/fixtures'

const PROJECT = 'project-fixture' as ProjectId

async function choose(row: string, option: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: row }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}

test('a project override is written for that project alone, and the default removes it', async ({
  client,
}) => {
  expect(client).toBeDefined()
  renderWithProviders(
    <ProjectSection
      project={{
        ref: { environmentId: activeEnvironmentId(), projectId: PROJECT },
        title: 'Fixture',
      }}
    />,
  )
  const autoPull = 'Keep the default branch current'
  expect(await screen.findByRole('combobox', { name: autoPull })).toHaveTextContent('Default · Off')

  await choose(autoPull, 'On')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['git.projectAutoPull']).toEqual({ [PROJECT]: true })
    expect(snapshot.values['git.autoPull']).toBe(false)
  })

  await choose(autoPull, 'Default · Off')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['git.projectAutoPull']).toEqual({})
  })
})

test('the two settlement rows share one override entry', async ({ client }) => {
  expect(client).toBeDefined()
  renderWithProviders(
    <ProjectSection
      project={{
        ref: { environmentId: activeEnvironmentId(), projectId: PROJECT },
        title: 'Fixture',
      }}
    />,
  )

  await choose('Settle inactive sessions after days', '7 days')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['chat.projectAutoSettle']).toEqual({ [PROJECT]: { afterDays: 7 } })
  })
  await choose('Settle sessions when their pull request merges', 'Off')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, getClient())
    expect(snapshot.values['chat.projectAutoSettle']).toEqual({
      [PROJECT]: { afterDays: 7, onMerge: false },
    })
  })
})

test('project title model and grouping rows edit and reset their own entries', async ({
  client,
}) => {
  renderWithProviders(
    <ProjectSection
      project={{
        ref: { environmentId: activeEnvironmentId(), projectId: PROJECT },
        title: 'Fixture',
      }}
    />,
  )
  await choose('Project grouping', 'Each machine apart')
  await waitFor(async () => {
    const snapshot = await fetchSettings(undefined, client)
    expect(snapshot.values['chat.projectGroupingOverrides']).toEqual({
      [`${activeEnvironmentId()}:${PROJECT}`]: 'separate',
    })
  })
  expect(await screen.findByRole('combobox', { name: 'Title generation model' })).toHaveTextContent(
    'Default',
  )
  await choose('Project grouping', 'Default · Repository')
  await waitFor(async () => {
    expect(
      (await fetchSettings(undefined, client)).values['chat.projectGroupingOverrides'],
    ).toEqual({})
  })
})

test('all project rows write and reset on their execution owner while grouping stays on the viewing owner', async ({
  server,
  client,
}) => {
  const federation = await createFederationHarness(server)
  const a = await registerFederatedProject(server, client, 'settings-a')
  const b = await registerFederatedProject(federation.serverB, federation.clientB, 'settings-b')
  expect(a.projectId).toBe(b.projectId)
  const sibling = 'another-project'
  await saveSettings(
    {
      mutationId: 'remote-title-seed',
      target: 'user',
      operations: [
        {
          kind: 'project.set',
          key: 'chat.projectTextGenerationModels',
          projectId: b.projectId,
          value: {
            providerInstanceId: v.parse(providerInstanceIdSchema, 'codex'),
            model: 'saved-custom-model',
            options: { reasoningEffort: 'low' },
          },
        },
        { kind: 'project.set', key: 'git.projectAutoPull', projectId: sibling, value: true },
      ],
    },
    federation.clientB,
  )
  const beforeA = await fetchSettings(undefined, client)
  const rendered = renderWithProviders(
    <ProjectSection
      project={{
        ref: { environmentId: federation.descriptorB.environmentId, projectId: b.projectId },
        title: 'Remote project',
      }}
    />,
  )
  try {
    expect(
      await screen.findByRole('combobox', { name: 'Title generation model' }),
    ).toHaveTextContent('saved-custom-model')
    const rows = [
      ['Response streaming', 'Token by token', 'chat.projectResponseStreamingModes', 'token'],
      ['Settle inactive sessions after days', '7 days', 'chat.projectAutoSettle', { afterDays: 7 }],
      [
        'Settle sessions when their pull request merges',
        'Off',
        'chat.projectAutoSettle',
        { afterDays: 7, onMerge: false },
      ],
      ['Keep the default branch current', 'On', 'git.projectAutoPull', true],
      ['Submodules in new worktrees', 'None', 'git.projectWorktreeSubmodules', 'none'],
      [
        'Remove worktrees after their last session is deleted',
        'Off',
        'git.projectWorktreeCleanupOnDelete',
        false,
      ],
    ] as const
    for (const [name, option, key, expected] of rows) {
      await choose(name, option)
      await waitFor(async () =>
        expect(
          (await fetchSettings(undefined, federation.clientB)).values[key][b.projectId],
        ).toEqual(expected),
      )
    }
    await choose('Title generation model', 'Codex · GPT-5.5')
    await waitFor(async () =>
      expect(
        (await fetchSettings(undefined, federation.clientB)).values[
          'chat.projectTextGenerationModels'
        ][b.projectId],
      ).toMatchObject({ providerInstanceId: 'codex', model: 'gpt-5.5' }),
    )
    expect((await fetchSettings(undefined, client)).layers).toEqual(beforeA.layers)

    await choose('Project grouping', 'Each machine apart')
    await waitFor(async () => {
      const values = (await fetchSettings(undefined, client)).values
      const refB = { environmentId: federation.descriptorB.environmentId, projectId: b.projectId }
      const refA = { environmentId: federation.descriptorA.environmentId, projectId: a.projectId }
      const identity = {
        source: 'git-remote',
        canonical: 'example.com/federated/fixture.git',
        remoteName: 'origin',
        host: 'example.com',
        path: 'federated/fixture.git',
      } as const
      const grouping = {
        mode: values['chat.projectGrouping'],
        overrides: values['chat.projectGroupingOverrides'],
      }
      expect(deriveProjectGroupKey(refB, identity, grouping)).toBe(
        `physical:${refB.environmentId}:${refB.projectId}`,
      )
      expect(deriveProjectGroupKey(refA, identity, grouping)).toBe(
        'repository:git-remote:example.com/federated/fixture.git',
      )
    })
    expect(
      (await fetchSettings(undefined, federation.clientB)).values['chat.projectGroupingOverrides'],
    ).toEqual({})
    for (const name of rows
      .map(([name]): string => name)
      .concat(['Title generation model', 'Project grouping'])) {
      await userEvent.click(await screen.findByRole('combobox', { name }))
      await userEvent.click(await screen.findByRole('option', { name: /^Default ·/ }))
    }
    await waitFor(async () => {
      const values = (await fetchSettings(undefined, federation.clientB)).values
      for (const key of new Set(rows.map(([, , key]) => key)))
        expect(values[key][b.projectId]).toBeUndefined()
      expect(values['chat.projectTextGenerationModels']).toEqual({})
      expect(values['git.projectAutoPull']).toEqual({ [sibling]: true })
      expect(
        (await fetchSettings(undefined, client)).values['chat.projectGroupingOverrides'],
      ).toEqual({})
    })
  } finally {
    rendered.unmount()
  }
})
