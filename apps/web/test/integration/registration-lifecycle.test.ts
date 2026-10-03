import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createProjectRegistrationCommand } from '@workspace/client-core/chat/registration'
import { orchestrationDispatchResultSchema } from '@workspace/contracts'
import { OrchestrationEventStore, orchestrationForApp, runGit } from 'server/testing'
import * as v from 'valibot'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { test, expect } from '../fixtures'

for (const kind of ['directory', 'unborn-git'] as const) {
  test(`${kind} registration keeps its branch and cursor through lifecycle settlement and repeated commands`, async ({
    client,
    server,
  }) => {
    const checkout = path.join(server.root, 'checkout')
    await mkdir(checkout)
    if (kind === 'unborn-git') {
      await runGit(checkout, ['init', '-b', 'main'], { cwdMode: 'option' })
      await runGit(checkout, ['remote', 'add', 'origin', 'https://github.com/acme/platform.git'], {
        cwdMode: 'option',
      })
    }
    const command = createProjectRegistrationCommand({ workspaceRoot: checkout, title: 'Fixture' })
    const first = v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(await client.orchestration.commands.post(command), { requireData: true }),
    )
    expect(first.result).toBeDefined()
    const store = new OrchestrationEventStore(server.database.db)
    expect(store.readAfter({ afterSequence: 0 })).toMatchObject([
      { type: 'project.created', commandId: command.commandId, sequence: 1 },
      { type: 'worktree.registered', commandId: command.commandId, sequence: 2 },
    ])
    const engine = orchestrationForApp(server.app)
    await engine.providerRuntimeIdle()
    expect(store.readAfter({ afterSequence: first.sequence })).toEqual([])
    expect(
      (await engine.readModelSnapshot()).worktrees.get(first.result!.worktreeId),
    ).toMatchObject({
      branch: kind === 'unborn-git' ? 'main' : null,
      headCommit: null,
      metadataVersion: 0,
    })
    const original = (await engine.readModelSnapshot()).projects.get(first.result!.projectId)
    const repeatedCommand = createProjectRegistrationCommand({
      workspaceRoot: checkout,
      title: 'Fixture',
    })
    const second = v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(await client.orchestration.commands.post(repeatedCommand), {
        requireData: true,
      }),
    )
    expect(second).toMatchObject({
      sequence: first.sequence,
      result: { ...first.result, disposition: 'existing-worktree' },
    })
    expect(store.readAfter({ afterSequence: first.sequence })).toEqual([])
    expect((await engine.readModelSnapshot()).projects.get(first.result!.projectId)).toEqual(
      original,
    )
    const retry = v.parse(
      orchestrationDispatchResultSchema,
      unwrapEdenResponse(await client.orchestration.commands.post(repeatedCommand), {
        requireData: true,
      }),
    )
    expect(retry).toEqual({ ...second, deduped: true })
  })
}
