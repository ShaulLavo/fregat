import { existsSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import {
  orchestrationCommandSchema,
  terminalLeaseIdSchema,
  worktreeIdSchema,
  type OrchestrationEvent,
} from '@workspace/contracts'
import { afterEach, expect, test, vi } from 'vitest'
import { closeTestApps } from '../../../test/server'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  stopLifecycleEffects,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../../git/service'
import { OrchestrationEngine } from '../engine'
import { SessionDeletionReactor } from '../session-deletion-reactor'
import { WorktreeLifecycleReactor } from '../worktree-lifecycle-reactor'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
const engines: OrchestrationEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
  vi.restoreAllMocks()
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test('startup reconciles orphans before cleanup and subscribes live reactors after terminal recovery', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const cleanup = await fixture.create()
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  const stopped = await stopLifecycleEffects(fixture)
  engines.push(stopped.engine)
  await stopped.engine.dispatch(
    v.parse(orchestrationCommandSchema, {
      type: 'worktree.cleanup',
      worktreeId: lifecycleWorktreeId,
      commandId: 'startup-pending-cleanup',
    }),
  )
  const terminalLeaseId = v.parse(terminalLeaseIdSchema, '44444444-4444-4444-8444-444444444469')
  await stopped.engine.dispatch(
    v.parse(orchestrationCommandSchema, {
      type: 'terminal.lease.request',
      commandId: 'startup-old-terminal-request',
      terminalLeaseId,
      worktreeId: fixture.registration.worktreeId,
      runtimeEpoch: 'previous-process',
    }),
  )
  const orphan = await stopped.git.prepareCreate({
    path: fixture.root,
    worktreeId: v.parse(worktreeIdSchema, '55555555-5555-4555-8555-555555555569'),
  })
  await stopped.git.create({ ...orphan, path: fixture.root })
  await stopped.engine.close()

  // Call-through spies observe the real reactors without replacing their behavior.
  const lifecycleEvents = vi.spyOn(WorktreeLifecycleReactor.prototype, 'handleEvents')
  const deletionEvents = vi.spyOn(SessionDeletionReactor.prototype, 'handleEvents')
  const paths = createWorkspacePaths(fixture.root)
  const restarted = new OrchestrationEngine(fixture.database.db, {
    attachmentsDir: path.join(fixture.root, '.git', 'attachments'),
    registration: {
      paths,
      git: new GitService(paths),
    },
  })
  engines.push(restarted)
  const recovery: { type: OrchestrationEvent['type']; cleanupExists: boolean }[] = []
  restarted.subscribeDomainEvents({
    name: 'test-observe-bootstrap-order',
    handleEvents: (events) => {
      for (const event of events)
        recovery.push({ type: event.type, cleanupExists: existsSync(cleanup.canonicalPath) })
    },
  })
  await restarted.ready
  await restarted.providerRuntimeIdle()

  expect(lifecycleEvents).not.toHaveBeenCalled()
  expect(deletionEvents).not.toHaveBeenCalled()
  expect(recovery.filter((event) => event.type !== 'worktree.metadata-refreshed')).toEqual([
    { type: 'terminal.lease-updated', cleanupExists: true },
    { type: 'worktree.orphan-registered', cleanupExists: true },
    { type: 'worktree.removed', cleanupExists: false },
  ])
  const recovered = await restarted.readModelSnapshot()
  expect(recovered.terminalLeases.get(terminalLeaseId)?.state).toBe('ended')
  expect(recovered.worktrees.get(lifecycleWorktreeId)?.lifecycle.state).toBe('removed')
  expect(
    [...recovered.worktrees.values()].find((row) => row.canonicalPath === orphan.absolutePath),
  ).toMatchObject({ ownership: 'unclaimed', lifecycle: { state: 'orphaned' } })
  expect(existsSync(orphan.absolutePath)).toBe(true)

  await restarted.dispatch(
    v.parse(orchestrationCommandSchema, {
      type: 'terminal.lease.request',
      commandId: 'startup-live-terminal-request',
      terminalLeaseId: '66666666-6666-4666-8666-666666666669',
      worktreeId: fixture.registration.worktreeId,
      runtimeEpoch: 'current-process',
    }),
  )
  expect(lifecycleEvents).toHaveBeenCalledOnce()
  expect(deletionEvents).toHaveBeenCalledOnce()
})
