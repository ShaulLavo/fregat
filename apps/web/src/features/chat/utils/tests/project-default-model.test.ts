import {
  orchestrationDispatchResultSchema,
  providerInstanceIdSchema,
  type ClientOrchestrationCommand,
  type ModelSelection,
  type ProjectId,
} from '@workspace/contracts'
import * as v from 'valibot'
import type { Client } from '@/lib/client'
import {
  createProjectDefaultModelCommand,
  createProjectMetaCommand,
  createWorkspaceProjectCommand,
} from '@workspace/client-core/chat/commands'
import { expect, test } from '../../../../../test/fixtures'

const claudeSelection: ModelSelection = {
  model: 'claude-opus-5',
  providerInstanceId: v.parse(providerInstanceIdSchema, 'claude'),
}

test('a registered project stores no invented model default', async ({ client, server }) => {
  const receipt = await dispatch(client, createWorkspaceProjectCommand({ rootPath: server.root }))
  const project = await readProject(client, receipt.result!.projectId)
  expect(project?.defaultModelSelection).toBeNull()
})

test('picking a model persists it as the project default', async ({ client, server }) => {
  const receipt = await dispatch(client, createWorkspaceProjectCommand({ rootPath: server.root }))
  const projectId = receipt.result!.projectId
  await dispatch(
    client,
    createProjectDefaultModelCommand({ defaultModelSelection: claudeSelection, projectId }),
  )
  expect((await readProject(client, projectId))?.defaultModelSelection).toEqual(claudeSelection)
})

test('renaming a project retains its stored model', async ({ client, server }) => {
  const receipt = await dispatch(client, createWorkspaceProjectCommand({ rootPath: server.root }))
  const projectId = receipt.result!.projectId
  await dispatch(
    client,
    createProjectDefaultModelCommand({ defaultModelSelection: claudeSelection, projectId }),
  )
  await dispatch(client, createProjectMetaCommand({ projectId, title: 'Renamed' }))
  expect(await readProject(client, projectId)).toMatchObject({
    title: 'Renamed',
    defaultModelSelection: claudeSelection,
  })
})

async function dispatch(client: Client, command: ClientOrchestrationCommand) {
  const response = await client.orchestration.commands.post(command)
  expect(response.error).toBeNull()
  return v.parse(orchestrationDispatchResultSchema, response.data)
}
async function readProject(client: Client, projectId: ProjectId) {
  const snapshot = await client.orchestration['shell-snapshot'].get()
  expect(snapshot.error).toBeNull()
  return snapshot.data?.projects.find((project) => project.id === projectId)
}
