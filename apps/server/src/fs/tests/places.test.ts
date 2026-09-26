import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { closeTestApps, createTestApp } from '../../../test/server'
import { testSettingsOptions } from '../../settings/testing'
import { parseUserDirs } from '../places'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('filesystem places', () => {
  it('lists only the home folders that exist', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'home', 'Documents'), { recursive: true })
    await mkdir(path.join(root, 'home', 'Downloads'))

    expect((await places(root)).places).toEqual([
      { kind: 'documents', label: 'Documents', path: 'home/Documents' },
      { kind: 'downloads', label: 'Downloads', path: 'home/Downloads' },
    ])
  })

  it('reads renamed folders from user-dirs.dirs and skips ones set to the home', async () => {
    const root = await fixtureRoot()
    const home = path.join(root, 'home')
    await mkdir(path.join(home, '.config'), { recursive: true })
    await mkdir(path.join(home, 'Desktop'))
    await mkdir(path.join(home, 'Papers'))
    await mkdir(path.join(root, 'elsewhere', 'Incoming'), { recursive: true })
    await writeFile(
      path.join(home, '.config', 'user-dirs.dirs'),
      [
        '# written by xdg-user-dirs-update',
        'XDG_DESKTOP_DIR="$HOME/"',
        'XDG_DOCUMENTS_DIR="$HOME/Papers"',
        `XDG_DOWNLOAD_DIR="${path.join(root, 'elsewhere', 'Incoming')}"`,
      ].join('\n'),
    )

    expect((await places(root)).places).toEqual([
      { kind: 'documents', label: 'Documents', path: 'home/Papers' },
      { kind: 'downloads', label: 'Downloads', path: 'elsewhere/Incoming' },
    ])
  })

  it('adds GTK bookmarks and dev folders once each, after the home folders', async () => {
    const root = await fixtureRoot()
    const home = path.join(root, 'home')
    await mkdir(path.join(home, '.config', 'gtk-3.0'), { recursive: true })
    await mkdir(path.join(home, 'Downloads'))
    await mkdir(path.join(home, 'Projects'))
    await mkdir(path.join(root, 'work', 'my stuff'), { recursive: true })
    await writeFile(
      path.join(home, '.config', 'gtk-3.0', 'bookmarks'),
      [
        `file://${path.join(home, 'Downloads')} Downloads`,
        `file://${encodeURI(path.join(root, 'work', 'my stuff'))} Stuff`,
        'sftp://host/srv Server',
        `file://${path.join(root, 'gone')}`,
      ].join('\n'),
    )

    expect((await places(root)).places).toEqual([
      { kind: 'downloads', label: 'Downloads', path: 'home/Downloads' },
      { kind: 'bookmark', label: 'Stuff', path: 'work/my stuff' },
      { kind: 'folder', label: 'Projects', path: 'home/Projects' },
    ])
  })

  it('offers the parent of opened projects with its checkout count', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'home'))
    for (const name of ['alpha', 'beta', 'gamma'])
      await mkdir(path.join(root, 'code', name, '.git'), { recursive: true })
    await mkdir(path.join(root, 'code', 'notes'))
    await mkdir(path.join(root, 'lonely', 'one'), { recursive: true })
    const app = testApp(root)
    for (const folder of ['code/alpha', 'lonely/one'])
      await request(app, '/fs/recents', { method: 'POST', body: JSON.stringify({ path: folder }) })

    expect((await places(root, app)).projects).toEqual([
      { label: 'code', path: 'code', repoCount: 3 },
    ])
  })

  it('drops a projects folder once it is deleted, though its picks remain', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'home'))
    for (const name of ['alpha', 'beta'])
      await mkdir(path.join(root, 'gone', name), { recursive: true })
    const app = testApp(root)
    for (const folder of ['gone/alpha', 'gone/beta'])
      await request(app, '/fs/recents', { method: 'POST', body: JSON.stringify({ path: folder }) })
    expect((await places(root, app)).projects).toEqual([
      { label: 'gone', path: 'gone', repoCount: 0 },
    ])

    await rm(path.join(root, 'gone'), { recursive: true })

    expect((await places(root, app)).projects).toEqual([])
  })

  it('always offers the browsable root as a drive', async () => {
    const root = await fixtureRoot()
    const { drives } = await places(root)
    expect(drives[0]).toMatchObject({ label: path.basename(root), path: '' })
  })

  it('parses only absolute and $HOME-relative values', () => {
    const dirs = parseUserDirs(
      'XDG_MUSIC_DIR="Music"\nXDG_DESKTOP_DIR="$HOME/Desk top"\nXDG_DOWNLOAD_DIR="$HOMEX/y"',
      '/h',
    )
    expect([...dirs]).toEqual([['XDG_DESKTOP_DIR', '/h/Desk top']])
  })
})

function testApp(root: string) {
  return createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    homeDirectory: path.join(root, 'home'),
    settings: testSettingsOptions(root),
    systemRoot: root,
    watch: false,
    workspaceRoot: root,
  })
}

async function request(app: ReturnType<typeof testApp>, route: string, init: RequestInit = {}) {
  const response = await app.handle(
    new Request(`http://local${route}`, {
      ...init,
      headers: { 'content-type': 'application/json', origin: TRUSTED_ORIGIN },
    }),
  )
  expect(response.status).toBe(200)
  return response
}

async function places(root: string, app = testApp(root)) {
  const response = await request(app, '/fs/places')
  return (await response.json()) as { drives: unknown[]; places: unknown[]; projects: unknown[] }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'fs-places-'))
  roots.push(root)
  return root
}
