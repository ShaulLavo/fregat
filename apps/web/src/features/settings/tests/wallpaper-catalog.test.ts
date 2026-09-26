import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { http, HttpResponse } from 'msw'
import { test, expect } from '../../../../test/fixtures'
import { server as msw } from '../../../../test/msw/server'
import { omarchyCatalogWebp, wallpaperPng } from '../../../../test/factories/wallpaper'

const LOGO = '8482e189755138084295e90f353b8efe8d3e575d7bc3fc3ed756d1e890242d32'
const LOGO_URL =
  'https://raw.githubusercontent.com/basecamp/omarchy/:commit/themes/catppuccin-latte/backgrounds/omarchy.webp'

test('downloads a catalog wallpaper from GitHub and drops it from the catalog', async ({
  client,
}) => {
  msw.use(http.get(LOGO_URL, () => new HttpResponse(omarchyCatalogWebp())))
  const before = (await client.themes.wallpapers.get()).data!
  expect(before.assets).toEqual([])
  expect(before.catalog.find((entry) => entry.asset === LOGO)).toMatchObject({
    theme: 'catppuccin-latte',
    file: 'omarchy.webp',
  })
  const installed = await client.themes.wallpapers.catalog({ id: LOGO }).post()
  expect(installed.error).toBeNull()
  expect(installed.data).toMatchObject({
    id: LOGO,
    name: 'catppuccin-latte · omarchy.webp',
    provenance: [{ kind: 'omarchy', theme: 'catppuccin-latte' }],
  })
  const after = (await client.themes.wallpapers.get()).data!
  expect(after.assets.map((asset) => asset.id)).toEqual([LOGO])
  expect(after.catalog).toHaveLength(before.catalog.length - 1)
})

test('refuses bytes that do not match the pinned hash', async ({ client }) => {
  msw.use(http.get(LOGO_URL, () => new HttpResponse(wallpaperPng())))
  const installed = await client.themes.wallpapers.catalog({ id: LOGO }).post()
  expect(installed.error?.status).toBe(502)
  expect((await client.themes.wallpapers.get()).data?.assets).toEqual([])
})

test('a local Omarchy file with the same theme and stem covers its catalog entry', async ({
  client,
  server,
}) => {
  const backgrounds = path.join(server.root, 'seed/catppuccin-latte/backgrounds')
  await mkdir(backgrounds, { recursive: true })
  await writeFile(path.join(backgrounds, 'omarchy.png'), wallpaperPng())
  await client.themes.wallpapers['import-directory'].post({ path: path.join(server.root, 'seed') })
  const { catalog } = (await client.themes.wallpapers.get()).data!
  expect(catalog.some((entry) => entry.asset === LOGO)).toBe(false)
})

test('the catalog is empty while the setting is off', async ({ client }) => {
  await client.settings.write.post({
    mutationId: crypto.randomUUID(),
    target: 'user',
    operations: [{ kind: 'set', key: 'workbench.wallpaper.omarchyCatalog', value: false }],
  })
  expect((await client.themes.wallpapers.get()).data?.catalog).toEqual([])
})

test('a stalled download leaves the listing free and gives up at the timeout', async ({
  client,
}) => {
  const written = await client.settings.write.post({
    mutationId: crypto.randomUUID(),
    target: 'user',
    operations: [{ kind: 'set', key: 'workbench.wallpaper.downloadTimeoutMs', value: 1000 }],
  })
  expect(written.error).toBeNull()
  msw.use(http.get(LOGO_URL, () => new Promise<never>(() => {})))
  const install = client.themes.wallpapers.catalog({ id: LOGO }).post()
  const first = await Promise.race([
    install.then(() => 'install'),
    client.themes.wallpapers.get().then(() => 'list'),
  ])
  expect(first).toBe('list')
  expect((await install).error?.status).toBe(424)
})

test('a body longer than the pinned size is refused', async ({ client }) => {
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(omarchyCatalogWebp())
      controller.enqueue(new Uint8Array(64 * 1024))
      controller.close()
    },
  })
  msw.use(http.get(LOGO_URL, () => new HttpResponse(oversized)))
  const installed = await client.themes.wallpapers.catalog({ id: LOGO }).post()
  expect(installed.error?.status).toBe(502)
  expect((await client.themes.wallpapers.get()).data?.assets).toEqual([])
})
