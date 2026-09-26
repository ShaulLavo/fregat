import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  clientOrchestrationCommandSchema,
  commandIdSchema,
  type SessionWorktreeTarget,
  type WorktreePullRequest,
} from '@workspace/contracts'
import { orchestrationForApp } from 'server/testing'
import * as v from 'valibot'
import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'
import { createProjectRegistrationCommand } from '@workspace/client-core/chat/registration'
import type { createInProcessClient } from '../client'
import type { TestServer } from '../server'
import { createRailHarness } from './rail-harness'
import { executeDomainGit } from './session-domain'

export async function createWorktreeLifecycleHarness(
  client: ReturnType<typeof createInProcessClient>,
  server: TestServer,
) {
  const rail = await createRailHarness(client, server, [])
  const repository = path.join(server.root, 'lifecycle')
  await mkdir(repository)
  await executeDomainGit(repository, 'init', '-b', 'main')
  await writeFile(path.join(repository, 'file.txt'), 'Initial content\n')
  await writeFile(path.join(repository, '.gitignore'), 'ignored.txt\n')
  await executeDomainGit(repository, 'add', '.')
  await executeDomainGit(
    repository,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.invalid',
    'commit',
    '-m',
    'Initial',
  )
  const registration = await rail.dispatch(
    createProjectRegistrationCommand({ workspaceRoot: 'lifecycle', title: 'Lifecycle project' }),
  )
  if (!registration.result) throw new TypeError('Registration did not return its worktree.')
  const { projectId, worktreeId } = registration.result
  const dispatch = async (input: unknown) => {
    const result = await rail.dispatch(v.parse(clientOrchestrationCommandSchema, input))
    await orchestrationForApp(server.app).providerRuntimeIdle()
    await rail.refresh()
    return result
  }
  await rail.refresh()
  return {
    ...rail,
    repository,
    projectId,
    worktreeId,
    dispatch,
    projectRef: { environmentId: rail.environmentId, projectId },
    async create(target: SessionWorktreeTarget) {
      const submission = createDraftSessionSubmission({
        createdAt: new Date().toISOString(),
        worktreeTarget: target,
        modelSelection: {
          model: 'mock-model',
          providerInstanceId: server.providerAdapter.adapterKey,
        },
        text: 'Work in this checkout',
      })
      await dispatch(submission.command)
      return submission.command.sessionId
    },
    /** Records what the forge answered for a worktree's branch, as the server's sync does. */
    async syncPullRequest(id: string, pullRequest: WorktreePullRequest) {
      const worktree = (await rail.refresh()).worktrees.find((item) => item.id === id)
      if (!worktree?.branch) throw new TypeError('Pull requests follow a worktree branch.')
      await orchestrationForApp(server.app).dispatch({
        type: 'worktree.pull-request.sync',
        commandId: v.parse(commandIdSchema, `pull-request-${crypto.randomUUID()}`),
        worktreeId: worktree.id,
        branch: worktree.branch,
        pullRequest,
      })
      await rail.refresh()
    },
    async worktree(id = worktreeId) {
      await orchestrationForApp(server.app).providerRuntimeIdle()
      const worktree = (await rail.refresh()).worktrees.find((worktree) => worktree.id === id)
      if (!worktree) throw new TypeError('Worktree projection missing.')
      return worktree
    },
  }
}
