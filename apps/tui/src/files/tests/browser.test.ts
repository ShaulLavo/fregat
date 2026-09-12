import path from 'node:path'
import { tmpdir } from 'node:os'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { mkdir, writeFile, symlink, mkdtemp, rm } from 'node:fs/promises'

import { createFileBrowser } from '@/files/state/browser'
import { openFileStorage } from '@/storage/files'
import { createControlledInProcessTransport } from '../../../test/client'
import { readEnvironmentDescriptor } from '@workspace/client-core/environments/descriptor'
import { createEnvironmentsStore } from '@workspace/client-core/environments/state/store'
import { test, expect } from '../../../test/fixtures'
import { createTestSettingsSession } from '../../../test/factories/session'
import { fileOptions, type FileLocation } from '@/files/utils/list'

test('cancelled initial path discovery cannot replace a newer folder listing', async ({
  server,
  client,
}) => {
  const descriptor = await readEnvironmentDescriptor({
    client,
    origin: server.origin,
    environments: createEnvironmentsStore({ primaryOrigin: server.origin }),
    signal: new AbortController().signal,
  })
  const storage = await openFileStorage(`${server.root}/tui`, descriptor.environmentId)
  const transport = createControlledInProcessTransport(server)
  const controlledClient = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const browser = createFileBrowser(controlledClient, storage)
  const gate = transport.pauseNextResponse('/health')
  try {
    const opening = browser.open()
    await gate.reached
    await browser.navigate('')
    const current = browser.getSnapshot()
    expect(current.listing.kind).toBe('ready')
    gate.release()
    await opening
    expect(browser.getSnapshot()).toBe(current)
  } finally {
    gate.release()
    browser.dispose()
    storage.close()
  }
})

test('initial file preview publishes only its confirmed file location and failed navigation adds none', async ({
  server,
  client,
}) => {
  await mkdir(`${server.root}/docs`)
  await writeFile(`${server.root}/docs/guide.md`, 'Guide contents')
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return expect.unreachable('Expected a ready session')
  const browser = createFileBrowser(client, state.storage)
  const locations: FileLocation[] = []
  browser.subscribe(() => {
    const location = browser.getSnapshot().location
    if (location && location !== locations.at(-1)) locations.push(location)
  })
  try {
    await browser.open('docs/guide.md')
    expect(locations).toEqual([{ path: 'docs/guide.md', rootPath: 'docs', kind: 'file' }])
    await browser.navigate('missing-directory')
    expect(browser.getSnapshot().listing.kind).toBe('failed')
    expect(locations).toHaveLength(1)
    await browser.navigate('docs')
    expect(locations.at(-1)).toMatchObject({ path: 'docs', kind: 'directory' })
  } finally {
    browser.dispose()
    session.dispose()
    await state.storage.flush()
  }
})

test('navigation cancels pending path completion without replacing the input', async ({
  server,
}) => {
  await mkdir(`${server.root}/docs`)
  const session = createTestSettingsSession(server)
  await session.refresh()
  const state = session.getSnapshot()
  if (state.kind !== 'ready') return expect.unreachable('Expected a ready session')
  const transport = createControlledInProcessTransport(server)
  const client = createEnvironmentClient({
    origin: server.origin,
    fetcher: transport.fetcher,
    headers: () => ({ origin: server.clientOrigin }),
  })
  const browser = createFileBrowser(client, state.storage)
  await browser.open()
  const gate = transport.pauseNextResponse('/fs/tree')
  try {
    const input = `${server.root}/do`
    const completion = browser.completePath(input)
    await gate.reached
    await browser.navigate('docs')
    gate.release()
    expect(await completion).toBe(input)
    expect(browser.getSnapshot().location).toMatchObject({ path: 'docs', kind: 'directory' })
  } finally {
    gate.release()
    browser.dispose()
    session.dispose()
    await state.storage.flush()
  }
})

test('parent navigation reaches the filesystem root and absolute paths can switch top-level directories', async ({
  server,
  client,
}) => {
  await mkdir(`${server.root}/home/person`, { recursive: true })
  await mkdir(`${server.root}/work/projects`, { recursive: true })
  await mkdir(`${server.root}/data/backups`, { recursive: true })
  const session = createTestSettingsSession(server)
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return expect.unreachable('Expected a ready session')
  const browser = createFileBrowser(client, ready.storage)
  try {
    await browser.open(`${server.root}/home/person`)
    expect(browser.getSnapshot()).toMatchObject({
      path: 'home/person',
      parentPath: 'home',
      location: { rootPath: 'home/person' },
    })
    await browser.goUp()
    expect(browser.getSnapshot()).toMatchObject({ path: 'home', parentPath: '' })
    await browser.goUp()
    expect(browser.getSnapshot()).toMatchObject({ path: '', parentPath: null })
    const root = browser.getSnapshot()
    await browser.goUp()
    expect(browser.getSnapshot()).toBe(root)
    expect(browser.enterPath(`${server.root}/work`)).toBeNull()
    await expect
      .poll(() => browser.getSnapshot().location)
      .toMatchObject({ path: 'work', rootPath: 'work', kind: 'directory' })
    expect(await browser.completePath('pro')).toBe(`${server.root}/work/projects/`)
    expect(browser.enterPath('../data')).toBeNull()
    await expect
      .poll(() => browser.getSnapshot().location)
      .toMatchObject({ path: 'data', rootPath: 'data' })
    expect(await browser.completePath('../wo')).toBe(`${server.root}/work/`)
    expect(browser.enterPath('../..')).toContain('outside')
    expect(browser.getSnapshot().path).toBe('data')
    await browser.open('')
    expect(browser.getSnapshot()).toMatchObject({ path: '', parentPath: null })
    expect(browser.enterPath('..')).toContain('outside')
  } finally {
    browser.dispose()
    session.dispose()
    await session.flush()
  }
})

test('directory links remain visible as links and keep logical parent navigation', async ({
  server,
  client,
}) => {
  await mkdir(`${server.root}/home/person`, { recursive: true })
  await mkdir(`${server.root}/work/projects`, { recursive: true })
  await writeFile(`${server.root}/work/projects/readme.txt`, 'Linked project')
  await symlink('../../work', `${server.root}/home/person/work`)
  const session = createTestSettingsSession(server)
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return expect.unreachable('Expected a ready session')
  const browser = createFileBrowser(client, ready.storage)
  try {
    await browser.open('home/person')
    const listing = browser.getSnapshot().listing
    if (listing.kind !== 'ready') return expect.unreachable('Expected a directory listing')
    const link = listing.entries.find((entry) => entry.name === 'work')
    if (!link) return expect.unreachable('Expected the work link')
    expect(link).toMatchObject({ type: 'symlink', targetType: 'directory' })
    expect(fileOptions([link], '')[0]).toMatchObject({
      name: '↗ work/',
      description: expect.stringContaining('Symbolic link'),
    })
    expect(await browser.completePath('wo')).toBe(`${server.root}/home/person/work/`)
    await browser.select(link)
    expect(browser.getSnapshot()).toMatchObject({
      path: 'home/person/work',
      parentPath: 'home/person',
      location: { rootPath: 'home/person/work' },
    })
    await browser.goUp()
    expect(browser.getSnapshot().path).toBe('home/person')
    await browser.open(`${server.root}/home/person/work/projects/readme.txt`)
    expect(browser.getSnapshot().location).toEqual({
      path: 'home/person/work/projects/readme.txt',
      rootPath: 'home/person/work/projects',
      kind: 'file',
    })
    expect(browser.getSnapshot().preview).toMatchObject({
      kind: 'ready',
      content: 'Linked project',
    })
  } finally {
    browser.dispose()
    session.dispose()
    await session.flush()
  }
})

test('a restricted browser cannot leave its filesystem root through a link or absolute path', async ({
  server,
  client,
}) => {
  const outside = await mkdtemp(path.join(tmpdir(), 'platform-tui-outside-'))
  await writeFile(`${outside}/private.txt`, 'Outside contents must not be listed')
  await symlink(outside, `${server.root}/outside`)
  const session = createTestSettingsSession(server)
  await session.refresh()
  const ready = session.getSnapshot()
  if (ready.kind !== 'ready') return expect.unreachable('Expected a ready session')
  const browser = createFileBrowser(client, ready.storage)
  try {
    await browser.open('')
    expect(browser.getSnapshot().location).toMatchObject({ path: '', rootPath: '' })
    await browser.navigate('outside')
    expect(browser.getSnapshot().listing.kind).toBe('failed')
    expect(browser.getSnapshot().location).toMatchObject({ path: '', rootPath: '' })
    expect(browser.enterPath(outside)).toContain('outside')
    await browser.open(outside)
    expect(browser.getSnapshot().listing).toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('outside'),
    })
    expect(browser.getSnapshot().location).toMatchObject({ path: '', rootPath: '' })
  } finally {
    browser.dispose()
    session.dispose()
    await session.flush()
    await rm(outside, { recursive: true, force: true })
  }
})
