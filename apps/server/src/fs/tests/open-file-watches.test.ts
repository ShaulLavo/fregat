import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { WatchServerMessage } from '../contracts'
import { createWorkspacePaths } from '../path'
import { FileChangeHub } from '../watch'

const cleanups: (() => Promise<unknown>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe.runIf(process.platform === 'linux')('open file watches', () => {
  it.each([
    { name: 'fixture root', rootOf: (fixture: string) => fixture },
    { name: 'filesystem root', rootOf: () => '/' },
  ])('follow a file opened through a linked folder ($name)', async ({ rootOf }) => {
    const fixture = await fixtureDirectory()
    await mkdir(path.join(fixture, 'project'))
    await mkdir(path.join(fixture, 'target'))
    await symlink('../target', path.join(fixture, 'project/linked'))
    let disk = path.join(fixture, 'target/probe.txt')
    await writeFile(disk, 'before\n')
    const paths = createWorkspacePaths(rootOf(fixture))
    const project = paths.toRelative(path.join(fixture, 'project'))
    const alias = `${project}/linked/probe.txt`
    const { events, hub, stop } = filesStream(paths, project, [alias])
    await expect.poll(() => events.some((event) => event.type === 'ready')).toBe(true)

    await expectChange(events, alias, () => writeFile(disk, 'after\n'))
    await expectChange(events, alias, async () => {
      await writeFile(`${disk}.tmp`, 'atomic\n')
      await rename(`${disk}.tmp`, disk)
    })

    const nextTarget = path.join(fixture, 'next-target')
    await mkdir(nextTarget)
    disk = path.join(nextTarget, 'probe.txt')
    await writeFile(disk, 'retargeted\n')
    await expectChange(events, alias, async () => {
      await symlink('../next-target', path.join(fixture, 'project/next-link'))
      await rename(path.join(fixture, 'project/next-link'), path.join(fixture, 'project/linked'))
    })
    await expectChange(events, alias, () => writeFile(disk, 'edit after retarget\n'))

    await expectChange(events, alias, async () => {
      await rename(nextTarget, path.join(fixture, 'old-target'))
      await mkdir(nextTarget)
      await writeFile(disk, 'replaced directory\n')
    })
    await expectChange(events, alias, () => writeFile(disk, 'edit after replacement\n'))

    await stop()
    await expect.poll(() => hub.info().openFileWatcherCount).toBe(0)
  })

  it('attaches a files stream without the project watcher', async () => {
    const fixture = await fixtureDirectory()
    await mkdir(path.join(fixture, 'project'))
    const disk = path.join(fixture, 'project/plain.txt')
    await writeFile(disk, 'before\n')
    const paths = createWorkspacePaths(fixture)
    const { events, hub, stop } = filesStream(paths, 'project', ['project/plain.txt'])
    await expect.poll(() => events.some((event) => event.type === 'ready')).toBe(true)

    // Parcel queues every subscribe behind any crawl in the process, so a files stream
    // that waited on it could hold an open file's events for as long as that crawl takes.
    expect(hub.info().nativeWatcherCount).toBe(0)
    await expectChange(events, 'project/plain.txt', () => writeFile(disk, 'after\n'))

    await stop()
    await expect.poll(() => hub.info().openFileWatcherCount).toBe(0)
  })
})

async function fixtureDirectory() {
  const fixture = await realpath(await mkdtemp(path.join(tmpdir(), 'platform-open-file-watch-')))
  cleanups.push(() => rm(fixture, { recursive: true, force: true }))
  return fixture
}

function filesStream(
  paths: ReturnType<typeof createWorkspacePaths>,
  project: string,
  files: readonly string[],
) {
  const hub = new FileChangeHub(paths, { enabled: true })
  const abort = new AbortController()
  const events: WatchServerMessage[] = []
  const drained = (async () => {
    for await (const event of hub.stream([project], abort.signal, { files, onlyFiles: true }))
      events.push(event)
  })()
  cleanups.push(() => hub.close())
  const stop = async () => {
    abort.abort()
    await drained
  }
  cleanups.push(stop)
  return { events, hub, stop }
}

async function expectChange(
  events: WatchServerMessage[],
  alias: string,
  change: () => Promise<unknown>,
) {
  events.length = 0
  await change()
  await expect
    .poll(() => events.some((event) => event.type === 'changed' && event.path === alias), {
      timeout: 3000,
    })
    .toBe(true)
}
