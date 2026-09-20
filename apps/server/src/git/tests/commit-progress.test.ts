import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../service'
import type { GitCommitProgressEvent } from '@workspace/contracts'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function testApp(root: string) {
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })

  return app
}

describe('streaming commit', () => {
  it('relays a hook’s output while the hook is still running', async () => {
    const root = await fixtureRepo()
    // Writes, then sleeps, then writes again: if the relay only flushed at exit
    // both lines would arrive together and the first assertion below could not
    // tell the difference.
    await writeHook(root, 'pre-commit', [
      'echo "checking types"',
      'sleep 0.4',
      'echo "checking lint"',
      'exit 0',
    ])
    await stageChange(root, 'two\n')

    const startedAt = performance.now()
    const arrivals = new Map<string, number>()
    const service = gitService(root)
    for await (const event of service.commitProgress({ message: 'hooked', path: root })) {
      if (event.kind !== 'progress') continue

      arrivals.set(event.text, performance.now() - startedAt)
    }

    const firstAt = arrivals.get('checking types')
    const lastAt = arrivals.get('checking lint')
    expect(firstAt).toBeDefined()
    expect(lastAt).toBeDefined()
    // Timing, not ordering: yielding buffered lines one at a time after the
    // process exits would satisfy any assertion about their order. The claim is
    // that the first line arrives while the hook is still sleeping, so it has to
    // beat the second by most of that sleep.
    expect(lastAt! - firstAt!).toBeGreaterThan(300)
  })

  it('commits and reports the result once the hooks pass', async () => {
    const root = await fixtureRepo()
    await stageChange(root, 'two\n')

    const events = await collect(gitService(root).commitProgress({ message: 'plain', path: root }))

    expect(events.at(-1)).toMatchObject({ kind: 'result', result: { kind: 'committed' } })
    expect(await headSubject(root)).toBe('plain')
  })

  it('reports a rejecting hook as a failure, with its reason already relayed', async () => {
    const root = await fixtureRepo()
    await writeHook(root, 'pre-commit', ['echo "lint failed on src/app.ts" >&2', 'exit 1'])
    await stageChange(root, 'two\n')

    const events = await collect(
      gitService(root).commitProgress({ message: 'rejected', path: root }),
    )

    expect(events.at(-1)?.kind).toBe('failed')
    // Hooks conventionally explain themselves on stderr; that is not a transport
    // error and it is the only thing telling the user what to fix.
    expect(events).toContainEqual({
      kind: 'progress',
      stream: 'stderr',
      text: 'lint failed on src/app.ts',
    })
    expect(await headSubject(root)).toBe('initial')
  })

  it('relays a colored hook line with its escapes and without its carriage return', async () => {
    const root = await fixtureRepo()
    await writeHook(root, 'pre-commit', [
      'printf "\\033[38;2;0;0;0m╭─\\033[m \\033[1mpre-commit\\033[m\\r\\n"',
      'exit 0',
    ])
    await stageChange(root, 'two\n')

    const events = await collect(gitService(root).commitProgress({ message: 'plain', path: root }))

    expect(events).toContainEqual({
      kind: 'progress',
      stream: 'stderr',
      text: '\x1b[38;2;0;0;0m╭─\x1b[m \x1b[1mpre-commit\x1b[m',
    })
  })

  it('reaches the client as an SSE stream, not one buffered body', async () => {
    const root = await fixtureRepo()
    await writeHook(root, 'pre-commit', ['echo "hook ran"', 'exit 0'])
    await stageChange(root, 'two\n')
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://localhost/git/commit-stream', {
        body: JSON.stringify({ message: 'streamed', path: root }),
        headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
        method: 'POST',
      }),
    )

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const body = await response.text()
    // The frame names carry the outcome, so a client can tell a hook line from
    // the verdict without parsing the payload.
    expect(body).toContain('event: progress')
    expect(body).toContain('hook ran')
    expect(body).toContain('event: result')
  })

  it('opens the message file when no message was typed, exactly like the one-shot route', async () => {
    const root = await fixtureRepo()
    await stageChange(root, 'two\n')

    const events = await collect(gitService(root).commitProgress({ message: '  ', path: root }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'result', result: { kind: 'message-file' } })
  })
})

async function collect(events: AsyncIterable<GitCommitProgressEvent>) {
  const collected: GitCommitProgressEvent[] = []
  for await (const event of events) {
    collected.push(event)
  }

  return collected
}

function gitService(root: string) {
  return new GitService(createWorkspacePaths(root), {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
}

async function writeHook(root: string, name: string, lines: readonly string[]) {
  const hooks = path.join(root, '.git', 'hooks')
  await mkdir(hooks, { recursive: true })
  const hook = path.join(hooks, name)
  await writeFile(hook, ['#!/bin/sh', ...lines, ''].join('\n'))
  await chmod(hook, 0o755)
}

async function stageChange(root: string, contents: string) {
  await writeFile(path.join(root, 'tracked.txt'), contents)
  await runGit(root, ['add', 'tracked.txt'])
}

async function headSubject(root: string) {
  return (await runGit(root, ['log', '-1', '--pretty=%s'])).trim()
}

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-commit-progress-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await runGit(root, ['config', 'user.email', 'test@example.com'])
  await runGit(root, ['config', 'user.name', 'Test User'])
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runGit(root, ['add', 'tracked.txt'])
  await runGit(root, ['commit', '-m', 'initial'])

  return root
}

async function runGit(root: string, args: readonly string[]) {
  const child = Bun.spawn(['git', '-C', root].concat(args), { stderr: 'pipe', stdout: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (exitCode === 0) return stdout

  throw new Error(`${stderr}${stdout}`.trim())
}
