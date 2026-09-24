import { strictEqual } from 'node:assert/strict'
import { chmod, mkdtemp, readdir, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { createScriptError } from '../structured-errors'
import { waitForApp } from './selectors'

export async function fixtureGit(project: string, args: readonly string[]) {
  const process = Bun.spawn(['git', '-C', project, ...args], { stdout: 'ignore', stderr: 'pipe' })
  if (await process.exited)
    throw createScriptError(`Fixture git failed: ${await new Response(process.stderr).text()}`)
}

/**
 * A temp repository with an identity and `a.txt` staged, ready to commit. The identity is set even
 * for fixtures that never commit: it costs nothing and a missing one fails far from its cause.
 */
export async function createGitFixture(slug: string) {
  const fixture = await mkdtemp(`/work/tmp/fregat-${slug}-`)
  await fixtureGit(fixture, ['init', '--quiet'])
  await fixtureGit(fixture, ['config', 'user.email', 'fregat@example.com'])
  await fixtureGit(fixture, ['config', 'user.name', 'Fregat'])
  await writeFile(path.join(fixture, 'a.txt'), 'one\n')
  await fixtureGit(fixture, ['add', 'a.txt'])
  return fixture
}

/** A temp repository where `file` was committed as `before` and now reads `after`, uncommitted. */
export async function createModifiedFileFixture(
  slug: string,
  file: string,
  before: readonly string[],
  after: readonly string[],
) {
  const fixture = await mkdtemp(`/work/tmp/fregat-${slug}-`)
  await fixtureGit(fixture, ['init', '--quiet'])
  await fixtureGit(fixture, ['config', 'user.email', 'fregat@example.com'])
  await fixtureGit(fixture, ['config', 'user.name', 'Fregat'])
  await writeFile(path.join(fixture, file), `${before.join('\n')}\n`)
  await fixtureGit(fixture, ['add', file])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
  await writeFile(path.join(fixture, file), `${after.join('\n')}\n`)
  return fixture
}

/** Installs an executable `pre-commit` hook in a fixture repository. */
export async function installPreCommitHook(fixture: string, script: string) {
  const hook = path.join(fixture, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, script)
  await chmod(hook, 0o755)
}

/** `git status --porcelain` of a fixture repository, trimmed. */
export async function fixturePorcelain(project: string) {
  const child = Bun.spawn(['git', '-C', project, 'status', '--porcelain'], { stdout: 'pipe' })
  return (await new Response(child.stdout).text()).trim()
}

/** The subject of the fixture repository's HEAD commit, or '' when it has none. */
export async function fixtureHeadSubject(project: string) {
  const child = Bun.spawn(['git', '-C', project, 'log', '-1', '--pretty=%s'], {
    stderr: 'ignore',
    stdout: 'pipe',
  })
  return (await new Response(child.stdout).text()).trim()
}

/** A save reaches disk after the app reports it, so poll before asserting. */
export async function waitForFileContent(file: string, expected: string) {
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    if ((await readFile(file, 'utf8')) === expected) return

    await Bun.sleep(50)
  }
  strictEqual(await readFile(file, 'utf8'), expected)
}

export async function openFixtureWorkspace(page: Page, project: string) {
  const current = new URL(page.url())
  const prefix = current.pathname.startsWith('/platform/') ? '/platform' : ''
  const api = current.port === '5173' ? 'http://localhost:3001' : `${current.origin}${prefix}`
  const response = await page.request.post(`${api}/fs/workspace-address`, {
    data: { path: project.slice(1) },
    headers: { Origin: current.origin },
  })
  if (!response.ok()) throw createScriptError(`Fixture workspace failed: ${response.status()}`)
  const workspace = await response.json()
  const token = encodeURIComponent(`${workspace.name}.${workspace.id}`)
  await page.goto(`${current.origin}${prefix}/~${token}/workbench`)
  await waitForApp(page)
}

/**
 * Removes a fixture and whatever the app still runs inside it. A workspace's terminal shell
 * persists by design and its language servers idle for minutes, so without this every run
 * leaves them on the server under test.
 */
export async function releaseFixture(fixture: string) {
  for (const pid of await processesIn(fixture)) process.kill(pid, 'SIGKILL')
  await rm(fixture, { recursive: true, force: true })
}

/** Processes whose working directory is the fixture, optionally filtered by their stdin target. */
export async function processesIn(
  fixture: string,
  stdin: (target: string) => boolean = () => true,
) {
  const pids = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry)).map(Number)
  const matches = await Promise.all(pids.map((pid) => runsIn(pid, fixture, stdin)))
  return pids.filter((_, index) => matches[index])
}

async function runsIn(pid: number, fixture: string, stdin: (target: string) => boolean) {
  const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => null)
  if (cwd !== fixture && cwd !== `${fixture} (deleted)`) return false

  return stdin(await readlink(`/proc/${pid}/fd/0`).catch(() => ''))
}
