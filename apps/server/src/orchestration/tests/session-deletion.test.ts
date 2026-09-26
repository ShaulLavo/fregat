import * as v from 'valibot'
import { worktreeIdSchema } from '@workspace/contracts'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
  createOrchestrationFixture,
  FIXTURE_SESSION_ID,
  mockRuntime,
  sessionFrom,
} from '../../../test/factories/orchestration'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { GitWorktreeService } from '../../git/worktrees'
import { runGit } from '../../testing/git'

const fixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

test('deleting one session preserves its real Git worktree and the other session sharing it', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  await runGit(fixture.checkout, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(fixture.checkout, 'keep.txt'), 'shared checkout file')
  await runGit(fixture.checkout, ['add', '.'], { cwdMode: 'option' })
  await runGit(fixture.checkout, ['commit', '-m', 'initial'], { cwdMode: 'option' })
  const adapter = new MockProviderAdapter()
  await fixture.restart(mockRuntime(adapter))
  await fixture.register()
  const worktrees = new GitWorktreeService(fixture.registration.git)
  const { worktree } = await worktrees.create({
    path: fixture.checkout,
    worktreeId: v.parse(worktreeIdSchema, 'dde613a3-4f1c-4910-9f43-f4ec70846daf'),
    baseCommit: (
      await runGit(fixture.checkout, ['rev-parse', 'HEAD'], { cwdMode: 'option' })
    ).stdout.trim(),
    branch: 'worktree/dde613a3-4f1c-4910-9f43-f4ec70846daf',
  })
  const registration = await fixture.register(worktree.absolutePath)
  if (!registration.result) throw new TypeError('Missing registration')
  const survivorId = '974a8f3c-3bc1-44d1-bc82-da59e3dc6cdf'
  await fixture.createSession(registration.result.worktreeId)
  await fixture.createSession(registration.result.worktreeId, survivorId)
  await fixture.startTurn()
  await fixture.startTurn(survivorId, 'survivor-first')
  await fixture.engine.providerRuntimeIdle()

  await fixture.command({
    type: 'session.delete',
    commandId: 'delete-one',
    sessionId: FIXTURE_SESSION_ID,
  })
  await fixture.engine.providerRuntimeIdle()

  expect(await readFile(path.join(worktree.absolutePath, 'keep.txt'), 'utf8')).toBe(
    'shared checkout file',
  )
  expect(
    (
      await runGit(worktree.absolutePath, ['status', '--porcelain'], { cwdMode: 'option' })
    ).stdout.trim(),
  ).toBe('')
  expect((await worktrees.list(fixture.checkout)).map((entry) => entry.absolutePath)).toContain(
    worktree.absolutePath,
  )
  expect((await sessionFrom(fixture)).deletedAt).not.toBeNull()
  expect(await sessionFrom(fixture, survivorId)).toMatchObject({
    deletedAt: null,
    worktreeId: registration.result.worktreeId,
  })
  expect(adapter.interruptedSessions).toEqual([FIXTURE_SESSION_ID])
  await fixture.startTurn(survivorId, 'survivor-after-delete')
  await fixture.engine.providerRuntimeIdle()
  expect(adapter.startedTurns.at(-1)).toMatchObject({
    sessionId: survivorId,
    cwd: worktree.absolutePath,
  })
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(registration.result.worktreeId)
      ?.retiredAt,
  ).toBeNull()
})

test('forced deletion stops the provider and retires ownership while preserving checkout files', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const adapter = new MockProviderAdapter()
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing registration')
  await fixture.createSession(registration.result.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  await writeFile(path.join(fixture.checkout, 'keep.txt'), 'developer file')
  await expect(
    fixture.command({
      type: 'project.delete',
      commandId: 'delete-no-force',
      projectId: registration.result.projectId,
    }),
  ).rejects.toThrow()
  await fixture.command({
    type: 'project.delete',
    commandId: 'delete-force',
    projectId: registration.result.projectId,
    force: true,
  })
  await fixture.engine.providerRuntimeIdle()
  expect(adapter.interruptedSessions).toEqual([FIXTURE_SESSION_ID])
  expect((await sessionFrom(fixture)).deletion).toMatchObject({
    providerStop: 'completed',
    blobCleanup: 'completed',
  })
  expect((await fixture.engine.shellSnapshot()).sessions).toHaveLength(0)
  expect(await readFile(path.join(fixture.checkout, 'keep.txt'), 'utf8')).toBe('developer file')
  const revived = await fixture.register()
  expect(revived.result).toEqual({ ...registration.result, disposition: 'revived-project' })
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(registration.result.worktreeId),
  ).toMatchObject({
    kind: 'current',
    ownership: 'protected',
    registrationGeneration: 1,
    retiredAt: null,
  })
  expect((await sessionFrom(fixture)).deletedAt).not.toBeNull()
})

test('provider failure is durable and blocks revival until restart releases ownership', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const adapter = new MockProviderAdapter({ stopError: 'provider stop refused' })
  await fixture.restart(mockRuntime(adapter))
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing registration')
  await fixture.createSession(registration.result.worktreeId)
  await fixture.startTurn()
  await fixture.engine.providerRuntimeIdle()
  await fixture.command({
    type: 'project.delete',
    commandId: 'delete',
    projectId: registration.result.projectId,
    force: true,
  })
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).deletion).toMatchObject({
    providerStop: 'failed',
    providerStopError: 'provider stop refused',
    blobCleanup: 'completed',
  })
  await expect(fixture.register()).rejects.toMatchObject({
    code: 'orchestration.REGISTRATION_BUSY',
  })
  const engine = await fixture.restart(mockRuntime())
  await engine.ready
  expect((await sessionFrom(fixture)).deletion).toMatchObject({
    providerStop: 'no-binding',
    providerStopError: null,
    blobCleanup: 'completed',
  })
  expect((await fixture.register()).result?.disposition).toBe('revived-project')
})

test('blob failure is separate from provider stop and startup retries it idempotently', async () => {
  const fixture = await createOrchestrationFixture()
  fixtures.push(fixture)
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing registration')
  await fixture.createSession(registration.result.worktreeId)
  const blobPath = path.join(fixture.root, 'attachments', 'image-1.png')
  await fixture.engine.dispatchClientCommand({
    type: 'session.turn.start',
    commandId: 'turn-image',
    sessionId: FIXTURE_SESSION_ID,
    turnId: 'turn-image',
    message: {
      messageId: 'image-message',
      role: 'user',
      text: 'Image',
      attachments: [
        {
          type: 'image',
          id: 'image-1',
          name: 'image.png',
          mimeType: 'image/png',
          sizeBytes: 3,
          dataUrl: 'data:image/png;base64,YWJj',
        },
      ],
    },
  })
  expect(await readFile(blobPath, 'utf8')).toBe('abc')
  await rm(blobPath)
  await mkdir(blobPath)
  await fixture.command({
    type: 'session.delete',
    commandId: 'delete-image',
    sessionId: FIXTURE_SESSION_ID,
  })
  await fixture.engine.providerRuntimeIdle()
  expect((await sessionFrom(fixture)).deletion).toMatchObject({
    providerStop: 'no-binding',
    blobCleanup: 'failed',
  })
  await rm(blobPath, { recursive: true })
  await fixture.restart()
  await fixture.engine.ready
  expect((await sessionFrom(fixture)).deletion).toMatchObject({
    providerStop: 'no-binding',
    blobCleanup: 'completed',
    blobCleanupError: null,
  })
  await expect(stat(blobPath)).rejects.toMatchObject({ code: 'ENOENT' })
  const before = (await fixture.engine.replay({ afterSequence: 0 })).events.length
  await fixture.restart()
  await fixture.engine.ready
  expect((await fixture.engine.replay({ afterSequence: 0 })).events).toHaveLength(before)
})
