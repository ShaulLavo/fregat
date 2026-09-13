import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GRAPHITE_PALETTE_DOCUMENT, type PaletteDocument } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { SettingsStore } from '../../settings/store'
import { PaletteLibrary } from '../palette-library'
import { themeRoutes } from '../routes'

const roots: string[] = []
const stores: SettingsStore[] = []

afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'palette-library-'))
  roots.push(root)
  const settings = new SettingsStore({
    secretsFilePath: path.join(root, 'secrets.json'),
    userFilePath: path.join(root, 'settings.json'),
    watch: false,
  })
  stores.push(settings)
  const directory = path.join(root, 'palettes')
  const library = new PaletteLibrary({ directory, settings })
  const app = themeRoutes(library)
  const call = (method: string, url: string, body?: unknown) =>
    app.handle(
      new Request(`http://local${url}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )

  return { call, directory, library, settings }
}

function userPalette(id = 'mine', name = 'Mine'): PaletteDocument {
  return { ...GRAPHITE_PALETTE_DOCUMENT, id, name }
}

describe('PaletteLibrary', () => {
  it('creates, lists, reads, updates and deletes through the routes', async () => {
    const { call, directory } = await harness()
    expect(await (await call('GET', '/themes/palettes')).json()).toEqual({ palettes: [] })

    const created = await call('POST', '/themes/palettes', userPalette())
    expect(created.status).toBe(200)
    const stored = (await created.json()) as PaletteDocument
    expect(stored.id).toBe('mine')
    // Every color is normalized to exact oklch on the way in.
    expect(stored.variants.kind === 'paired' && stored.variants.dark.terminal.red).toMatch(
      /^oklch\(/u,
    )
    expect(await readdir(directory)).toEqual(['mine.json'])

    const listed = (await (await call('GET', '/themes/palettes')).json()) as {
      palettes: PaletteDocument[]
    }
    expect(listed.palettes.map((palette) => palette.id)).toEqual(['mine'])
    expect((await (await call('GET', '/themes/palettes/mine')).json()).name).toBe('Mine')

    const updated = await call('POST', '/themes/palettes/mine', userPalette('mine', 'Renamed'))
    expect(updated.status).toBe(200)
    expect(JSON.parse(await readFile(path.join(directory, 'mine.json'), 'utf8')).name).toBe(
      'Renamed',
    )

    const deleted = await call('POST', '/themes/palettes/mine/delete')
    expect(deleted.status).toBe(200)
    expect(await readdir(directory)).toEqual([])
    expect((await call('GET', '/themes/palettes/mine')).status).toBe(404)
  })

  it('refuses bundled ids, duplicates, mismatched ids and invalid documents', async () => {
    const { call } = await harness()
    expect((await call('POST', '/themes/palettes', userPalette('graphite'))).status).toBe(409)
    expect((await call('POST', '/themes/palettes/graphite/delete')).status).toBe(409)

    expect((await call('POST', '/themes/palettes', userPalette())).status).toBe(200)
    expect((await call('POST', '/themes/palettes', userPalette())).status).toBe(409)
    expect((await call('POST', '/themes/palettes/mine', userPalette('other'))).status).toBe(400)
    expect((await call('POST', '/themes/palettes/other', userPalette('other'))).status).toBe(404)

    const invalid = await call('POST', '/themes/palettes', { ...userPalette(), variants: {} })
    expect(invalid.status).toBe(400)
    expect((await call('GET', '/themes/palettes/Not%20Valid')).status).toBe(400)
  })

  it('moves the selection to Graphite before deleting the selected palette', async () => {
    const { call, settings, directory } = await harness()
    await call('POST', '/themes/palettes', userPalette())
    await settings.write({
      mutationId: 'select-mine',
      operations: [{ key: 'workbench.palette', kind: 'set', value: 'mine' }],
      target: 'user',
    })
    expect(settings.snapshot().values['workbench.palette']).toBe('mine')

    expect((await call('POST', '/themes/palettes/mine/delete')).status).toBe(200)
    expect(settings.snapshot().values['workbench.palette']).toBe('graphite')
    expect(await readdir(directory)).toEqual([])
  })

  it('keeps the file when the fallback write is rejected', async () => {
    const { directory, settings } = await harness()
    const rejecting = new PaletteLibrary({
      directory,
      settings: {
        snapshot: () => settings.snapshot(),
        write: () => Promise.reject(new Error('read-only')),
      },
    })
    await rejecting.create(userPalette())
    await settings.write({
      mutationId: 'select-mine',
      operations: [{ key: 'workbench.palette', kind: 'set', value: 'mine' }],
      target: 'user',
    })

    await expect(rejecting.delete('mine')).rejects.toMatchObject({
      code: 'themes.PALETTE_SELECTED_WRITE_REJECTED',
    })
    expect(await readdir(directory)).toEqual(['mine.json'])
  })

  it('skips a file that does not parse or whose name disagrees with its id', async () => {
    const { call, directory, library } = await harness()
    await library.create(userPalette())
    await writeFile(path.join(directory, 'broken.json'), '{not json')
    await writeFile(path.join(directory, 'wrong-name.json'), JSON.stringify(userPalette('mine')))

    const listed = (await (await call('GET', '/themes/palettes')).json()) as {
      palettes: PaletteDocument[]
    }
    expect(listed.palettes.map((palette) => palette.id)).toEqual(['mine'])
  })
})
