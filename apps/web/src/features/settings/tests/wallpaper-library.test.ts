import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../../../../test/fixtures'
import { SettingsStore } from '../../../../../server/src/settings/store'
import { WallpaperLibrary } from '../../../../../server/src/themes/wallpapers/library'

import { wallpaperPng } from '../../../../test/factories/wallpaper'

test('uploads, deduplicates and serves a decoded still and generated thumbnail', async ({
  client,
  server,
}) => {
  const bytes = wallpaperPng()
  const first = await client.themes.wallpapers.post({ file: new File([bytes], 'one.png') })
  expect(first.error).toBeNull()
  const asset = first.data!
  expect(asset).toMatchObject({
    name: 'one.png',
    width: 48,
    height: 32,
    contentType: 'image/png',
    redistribution: 'unverified',
  })
  const second = await client.themes.wallpapers.post({ file: new File([bytes], 'two.png') })
  expect(second.data?.id).toBe(asset.id)
  expect((await client.themes.wallpapers.get()).data?.assets).toHaveLength(1)
  const image = await server.app.handle(
    new Request(`http://localhost/themes/wallpapers/${asset.id}/asset`, {
      headers: { origin: server.origin },
    }),
  )
  expect(image.status).toBe(200)
  expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes)
  const thumbnail = await readFile(path.join(server.root, '.platform/wallpapers', asset.thumbnail))
  expect(thumbnail.subarray(8, 12).toString()).toBe('WEBP')
  const display = await server.app.handle(
    new Request(`http://localhost/themes/wallpapers/${asset.id}/display`, {
      headers: { origin: server.origin },
    }),
  )
  expect(display.headers.get('content-type')).toBe('image/webp')
  expect(
    Buffer.from(await display.arrayBuffer())
      .subarray(8, 12)
      .toString(),
  ).toBe('WEBP')
})

test('a repeat install writes the display rendition an older entry lacks', async ({
  client,
  server,
}) => {
  const file = () => new File([wallpaperPng()], 'one.png')
  const asset = (await client.themes.wallpapers.post({ file: file() })).data!
  const display = path.join(server.root, '.platform/wallpapers', `${asset.id}.display.webp`)
  await rm(display)
  await client.themes.wallpapers.post({ file: file() })
  expect((await readFile(display)).subarray(8, 12).toString()).toBe('WEBP')
})

test('an import skips a file it cannot decode and keeps the rest', async ({ client, server }) => {
  const backgrounds = path.join(server.root, 'seed/day/backgrounds')
  await mkdir(backgrounds, { recursive: true })
  await writeFile(path.join(backgrounds, 'broken.png'), 'not an image')
  await writeFile(path.join(backgrounds, 'still.png'), wallpaperPng())
  const imported = await client.themes.wallpapers['import-directory'].post({
    path: path.join(server.root, 'seed'),
  })
  expect(imported.data?.themes.day).toHaveLength(1)
  expect(imported.data?.skipped).toEqual([
    { path: path.join(backgrounds, 'broken.png'), code: 'wallpapers.INVALID' },
  ])
})

test('the listing sees an index entry written by another process', async ({ client, server }) => {
  const asset = (await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'a.png') }))
    .data!
  expect((await client.themes.wallpapers.get()).data?.assets).toHaveLength(1)
  const other = 'f'.repeat(64)
  await writeFile(
    path.join(server.root, '.platform/wallpapers', `${other}.json`),
    JSON.stringify({ ...asset, id: other, name: 'b.png', thumbnail: `${other}.thumb.webp` }),
  )
  expect((await client.themes.wallpapers.get()).data?.assets).toHaveLength(2)
})

test('rejects invalid, oversized and over-dimension images before writing files', async ({
  client,
  server,
}) => {
  const oversized = new Uint8Array(20 * 1024 * 1024 + 1)
  const huge = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAQAEAAAABCAIAAABGP0oxAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA80lEQVR4nO3QMQ0AAAgDMMxNy7TgGhk8Taqgky4GDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYMCAAQMGDBgwYCD9d9J6RbnDpq7EAAAAAElFTkSuQmCC',
    'base64',
  )
  for (const bytes of [new TextEncoder().encode('not an image'), oversized, huge]) {
    const response = await client.themes.wallpapers.post({ file: new File([bytes], 'invalid.png') })
    expect(response.status).toBe(bytes === oversized ? 413 : 400)
    expect(response.error).not.toBeNull()
  }
  await client.themes.wallpapers.get()
  expect(await readdir(path.join(server.root, '.platform/wallpapers'))).toEqual([])
})

test('disables wallpaper and releases the selected asset before deleting it', async ({
  client,
}) => {
  const uploaded = await client.themes.wallpapers.post({
    file: new File([wallpaperPng()], 'selected.png'),
  })
  const id = uploaded.data!.id
  const written = await client.settings.write.post({
    mutationId: 'select-wallpaper',
    target: 'user',
    operations: [
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: true, source: { kind: 'library', asset: id } },
      },
    ],
  })
  expect(written.error).toBeNull()
  const removed = await client.themes.wallpapers({ id }).delete.post()
  expect(removed.error).toBeNull()
  expect(removed.data?.settings.values['workbench.wallpaper']).toEqual({
    enabled: false,
    source: { kind: 'desktop' },
  })
  expect((await client.themes.wallpapers.get()).data?.assets).toEqual([])
})

test('a rejected fallback keeps the image on disk', async ({ server }) => {
  const settings = new SettingsStore({
    userFilePath: path.join(server.root, 'rejected-settings.json'),
    secretsFilePath: path.join(server.root, 'rejected-secrets.json'),
    watch: false,
  })
  const directory = path.join(server.root, 'rejected-library')
  const library = new WallpaperLibrary({ directory, settings })
  const asset = await library.upload(new File([wallpaperPng()], 'selected.png'))
  await settings.write({
    mutationId: 'select',
    target: 'user',
    operations: [
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: true, source: { kind: 'library', asset: asset.id } },
      },
    ],
  })
  // A real unwritable document boundary, without replacing the settings writer.
  await rm(path.join(server.root, 'rejected-settings.json'))
  await mkdir(path.join(server.root, 'rejected-settings.json'))
  await expect(library.delete(asset.id)).rejects.toBeDefined()
  expect(await readFile(path.join(directory, `${asset.id}.png`))).toEqual(wallpaperPng())
  settings.close()
})

test('imports a theme fixture twice with stable ids and complete provenance', async ({
  client,
  server,
}) => {
  const directory = path.join(server.root, 'themes')
  for (const theme of ['day', 'night']) {
    await mkdir(path.join(directory, theme, 'backgrounds'), { recursive: true })
    await writeFile(path.join(directory, theme, 'backgrounds', 'still.png'), wallpaperPng())
  }
  const first = await client.themes.wallpapers['import-directory'].post({ path: directory })
  const second = await client.themes.wallpapers['import-directory'].post({ path: directory })
  expect(first.error).toBeNull()
  expect(second.data).toEqual(first.data)
  const assets = (await client.themes.wallpapers.get()).data!.assets
  expect(assets).toHaveLength(1)
  expect(assets[0]?.provenance).toEqual(
    ['day', 'night'].map((theme) => ({
      kind: 'omarchy',
      theme,
      path: path.join(directory, theme, 'backgrounds/still.png'),
    })),
  )
  expect(assets[0]?.redistribution).toBe('unverified')
})
