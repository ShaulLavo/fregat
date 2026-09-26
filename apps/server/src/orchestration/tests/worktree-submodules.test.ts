import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { runGit } from '../../testing/git'
import {
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
const scratch: string[] = []
// Git refuses file:// submodule clones by default; the fixture remotes are local directories.
const fileTransport = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'protocol.file.allow',
  GIT_CONFIG_VALUE_0: 'always',
}
beforeAll(() => Object.assign(process.env, fileTransport))
afterAll(() => {
  for (const key of Object.keys(fileTransport)) delete process.env[key]
})
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await Promise.all(scratch.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  await closeTestApps()
})

async function repository(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-submodule-'))
  scratch.push(root)
  await runGit(root, ['init', '-b', 'main'], { cwdMode: 'option' })
  await runGit(root, ['config', 'user.name', 'Submodule Test'], { cwdMode: 'option' })
  await runGit(root, ['config', 'user.email', 'submodule@example.invalid'], { cwdMode: 'option' })
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(root, name), text)
  await runGit(root, ['add', '.'], { cwdMode: 'option' })
  await runGit(root, ['commit', '-m', 'initial'], { cwdMode: 'option' })
  return root
}

async function addSubmodule(root: string, url: string, name: string) {
  await runGit(root, ['-c', 'protocol.file.allow=always', 'submodule', 'add', url, name], {
    cwdMode: 'option',
  })
  await runGit(root, ['commit', '-m', `add ${name}`], { cwdMode: 'option' })
}

/** Root → middle → leaf, so recursive and top-level produce different trees. */
async function nestedFixture(settings?: (projectId: string) => Record<string, unknown>) {
  const leaf = await repository({ 'leaf.txt': 'leaf\n' })
  const middle = await repository({ 'middle.txt': 'middle\n' })
  await addSubmodule(middle, leaf, 'leaf')
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  await addSubmodule(fixture.root, middle, 'middle')
  if (settings) {
    const values = settings(fixture.registration.projectId)
    await writeFile(path.join(fixture.root, '.git', 'settings.json'), JSON.stringify(values))
    await fixture.restart()
  }
  return fixture
}

async function exists(target: string) {
  return stat(target).then(
    () => true,
    () => false,
  )
}

async function status(fixture: Awaited<ReturnType<typeof nestedFixture>>, worktreePath: string) {
  const response = await fixture.app.handle(
    new Request(`http://localhost/git/status?path=${encodeURIComponent(worktreePath)}&fresh=true`, {
      headers: { origin: TRUSTED_ORIGIN },
    }),
  )
  const body = await response.json()
  if (response.status !== 200) throw new TypeError(JSON.stringify(body))
  return body as { uninitializedSubmodules: number }
}

test('a new worktree initializes nested submodules by default', async () => {
  const fixture = await nestedFixture()
  const worktree = await fixture.create()
  expect(worktree.lifecycle.state).toBe('ready')
  expect(await exists(path.join(worktree.canonicalPath, 'middle', 'middle.txt'))).toBe(true)
  expect(await exists(path.join(worktree.canonicalPath, 'middle', 'leaf', 'leaf.txt'))).toBe(true)
  expect((await status(fixture, worktree.path)).uninitializedSubmodules).toBe(0)
})

test('the project override wins over the machine default', async () => {
  const fixture = await nestedFixture((projectId) => ({
    'git.worktreeSubmodules': 'none',
    'git.projectWorktreeSubmodules': { [projectId]: 'top-level' },
  }))
  const worktree = await fixture.create()
  expect(await exists(path.join(worktree.canonicalPath, 'middle', 'middle.txt'))).toBe(true)
  expect(await exists(path.join(worktree.canonicalPath, 'middle', 'leaf', 'leaf.txt'))).toBe(false)
})

test('none leaves submodules empty, and status offers them for an explicit init', async () => {
  const fixture = await nestedFixture(() => ({ 'git.worktreeSubmodules': 'none' }))
  const worktree = await fixture.create()
  expect(await exists(path.join(worktree.canonicalPath, 'middle', 'middle.txt'))).toBe(false)
  expect((await status(fixture, worktree.path)).uninitializedSubmodules).toBe(1)

  const response = await fixture.app.handle(
    new Request('http://localhost/git/submodules/init', {
      method: 'POST',
      headers: { origin: TRUSTED_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ path: worktree.path }),
    }),
  )
  expect(response.status).toBe(200)
  expect(
    ((await response.json()) as { uninitializedSubmodules: number }).uninitializedSubmodules,
  ).toBe(0)
  expect(await exists(path.join(worktree.canonicalPath, 'middle', 'middle.txt'))).toBe(true)
})

test('a failed submodule clone keeps the worktree and reports the empty submodule', async () => {
  const fixture = await nestedFixture()
  const middle = (
    await runGit(fixture.root, ['config', '--file', '.gitmodules', 'submodule.middle.url'], {
      cwdMode: 'option',
    })
  ).stdout.trim()
  await rm(middle, { recursive: true, force: true })
  const worktree = await fixture.create()
  expect(worktree.lifecycle.state).toBe('ready')
  expect(fixture.adapter.startedTurns).toHaveLength(1)
  expect((await status(fixture, worktree.path)).uninitializedSubmodules).toBe(1)
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('ready')
})
