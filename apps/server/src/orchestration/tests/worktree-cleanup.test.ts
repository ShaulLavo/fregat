import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { executeGit, FIXTURE_MODEL } from '../../../test/factories/orchestration'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  sharedSessionId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'

type Fixture = Awaited<ReturnType<typeof worktreeLifecycleFixture>>

const fixtures: Fixture[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

async function fixtureWith(settings?: (projectId: string) => Record<string, unknown>) {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  if (settings) {
    const values = settings(fixture.registration.projectId)
    await writeFile(path.join(fixture.root, '.git', 'settings.json'), JSON.stringify(values))
    await fixture.restart()
  }
  return fixture
}

/** Deletes the session, lets its stop and any cleanup it triggers finish, and reads the worktree. */
async function deleteSession(fixture: Fixture, removeWorktree?: boolean) {
  await fixture.command({
    type: 'session.delete',
    sessionId: lifecycleSessionId,
    ...(removeWorktree ? { removeWorktree } : {}),
  })
  await fixture.engine.providerRuntimeIdle()
  await fixture.engine.cleanupWorktrees()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const worktree = (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)
    if (worktree?.lifecycle.state !== 'cleanup-requested') return worktree
    await Bun.sleep(20)
  }
  throw new TypeError('cleanup never finished')
}

async function exists(target: string) {
  return stat(target).then(
    () => true,
    () => false,
  )
}

test('a deletion that asks for it removes the worktree and keeps its branch', async () => {
  const fixture = await fixtureWith()
  const created = await fixture.create()
  const removed = await deleteSession(fixture, true)
  expect(removed?.lifecycle.state).toBe('removed')
  expect(await exists(created.canonicalPath)).toBe(false)
  await executeGit(fixture.root, 'rev-parse', '--verify', `refs/heads/${created.branch}`)
})

test('without the request or the setting the worktree stays', async () => {
  const fixture = await fixtureWith()
  const created = await fixture.create()
  expect((await deleteSession(fixture))?.lifecycle.state).toBe('ready')
  expect(await exists(created.canonicalPath)).toBe(true)
})

test('the project setting removes it after any deletion', async () => {
  const fixture = await fixtureWith((projectId) => ({
    'git.projectWorktreeCleanupOnDelete': { [projectId]: true },
  }))
  const created = await fixture.create()
  expect((await deleteSession(fixture))?.lifecycle.state).toBe('removed')
  expect(await exists(created.canonicalPath)).toBe(false)
})

test.each([
  ['a changed file', (root: string) => writeFile(path.join(root, 'tracked.txt'), 'edited\n')],
  ['an ignored file', (root: string) => writeFile(path.join(root, 'ignored.txt'), 'secret\n')],
  ['another branch', (root: string) => executeGit(root, 'checkout', '-b', 'elsewhere')],
])('%s keeps the worktree', async (_name, change) => {
  const fixture = await fixtureWith(() => ({ 'git.worktreeCleanupOnDelete': true }))
  const created = await fixture.create()
  await change(created.canonicalPath)
  expect((await deleteSession(fixture))?.lifecycle.state).toBe('ready')
  expect(await exists(created.canonicalPath)).toBe(true)
})

test('an ignored node_modules does not keep it', async () => {
  const fixture = await fixtureWith(() => ({ 'git.worktreeCleanupOnDelete': true }))
  const created = await fixture.create()
  await writeFile(path.join(created.canonicalPath, '.gitignore'), 'ignored.txt\nnode_modules/\n')
  await executeGit(created.canonicalPath, 'commit', '-am', 'ignore dependencies')
  await mkdir(path.join(created.canonicalPath, 'node_modules', 'left-pad'), { recursive: true })
  await writeFile(path.join(created.canonicalPath, 'node_modules', 'left-pad', 'index.js'), '')
  expect((await deleteSession(fixture))?.lifecycle.state).toBe('removed')
})

test('an archived session on the same worktree keeps it', async () => {
  const fixture = await fixtureWith(() => ({ 'git.worktreeCleanupOnDelete': true }))
  const created = await fixture.create()
  await fixture.command({
    type: 'session.create',
    sessionId: sharedSessionId,
    worktreeTarget: { kind: 'current', worktreeId: lifecycleWorktreeId },
    title: 'Shared',
    modelSelection: FIXTURE_MODEL,
  })
  await fixture.command({ type: 'session.archive', sessionId: sharedSessionId })
  expect((await deleteSession(fixture, true))?.lifecycle.state).toBe('ready')
  expect(await exists(created.canonicalPath)).toBe(true)
})
