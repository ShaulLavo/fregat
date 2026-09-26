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

    expect(await places(root)).toEqual([
      { id: 'documents', path: 'home/Documents' },
      { id: 'downloads', path: 'home/Downloads' },
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

    expect(await places(root)).toEqual([
      { id: 'documents', path: 'home/Papers' },
      { id: 'downloads', path: 'elsewhere/Incoming' },
    ])
  })

  it('parses only absolute and $HOME-relative values', () => {
    const dirs = parseUserDirs(
      'XDG_MUSIC_DIR="Music"\nXDG_DESKTOP_DIR="$HOME/Desk top"\nXDG_DOWNLOAD_DIR="$HOMEX/y"',
      '/h',
    )
    expect([...dirs]).toEqual([['XDG_DESKTOP_DIR', '/h/Desk top']])
  })
})

async function places(root: string) {
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    homeDirectory: path.join(root, 'home'),
    settings: testSettingsOptions(root),
    systemRoot: root,
    watch: false,
    workspaceRoot: root,
  })
  const response = await app.handle(
    new Request('http://local/fs/places', { headers: { origin: TRUSTED_ORIGIN } }),
  )
  expect(response.status).toBe(200)
  const payload = (await response.json()) as { places: unknown[] }
  return payload.places
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'fs-places-'))
  roots.push(root)
  return root
}
