import { bundledPalette, paletteColorsFor } from '@workspace/contracts'
import { contrastFailures } from '@workspace/client-core/themes/palette-editing'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { themeDocument } from '../../../../test/factories/theme-bundle'
import {
  BUNDLED_THEMES,
  resolveThemeSettings,
  themeVariants,
  type ThemeBundle,
} from '@workspace/contracts'
import { test, expect } from '../../../../test/fixtures'
import { wallpaperPng } from '../../../../test/factories/wallpaper'
import { makeTestServer } from '../../../../test/server'
import { createInProcessClient } from '../../../../test/client'

test('switches every part by mode and retains concurrent customizations by variant', async ({
  client,
  server,
}) => {
  const secondClient = createInProcessClient(server)
  const created = await client.themes.bundles.post(themeDocument())
  expect(created.error).toBeNull()
  const theme = created.data!
  const select = (bundle: ThemeBundle) =>
    client.settings.write.post({
      mutationId: crypto.randomUUID(),
      target: 'user',
      operations: [{ kind: 'set', key: 'workbench.theme', value: bundle }],
    })
  expect((await select(theme)).error).toBeNull()
  const writes = await Promise.all([
    client.settings.write.post({
      mutationId: 'theme-opacity',
      target: 'user',
      operations: [
        {
          kind: 'theme.customize',
          id: theme.id,
          mode: 'dark',
          patch: { material: { opacity: 40 } },
        },
      ],
    }),
    secondClient.settings.write.post({
      mutationId: 'theme-blur',
      target: 'user',
      operations: [
        { kind: 'theme.customize', id: theme.id, mode: 'dark', patch: { material: { blur: 3 } } },
      ],
    }),
    client.settings.write.post({
      mutationId: 'theme-light-wallpaper',
      target: 'user',
      operations: [
        {
          kind: 'theme.customize',
          id: theme.id,
          mode: 'light',
          patch: { wallpaper: { enabled: true, source: { kind: 'desktop' } } },
        },
      ],
    }),
  ])
  for (const write of writes) expect(write.error).toBeNull()
  let values = (await client.settings.get()).data!.values
  const light = resolveThemeSettings(values, 'light')
  const dark = resolveThemeSettings(values, 'dark')
  expect(light['workbench.palette']).toBe('sage')
  expect(dark['workbench.palette']).toBe('graphite')
  expect(dark['workbench.surface.opacity']).toBe(40)
  expect(dark['workbench.surface.blur']).toBe(3)
  expect(light['workbench.surface.opacity']).toBe(80)
  await select(BUNDLED_THEMES[1]!)
  values = (await client.settings.get()).data!.values
  expect(resolveThemeSettings(values, 'light')['workbench.wallpaper']).toEqual(
    BUNDLED_THEMES[1]!.variants.light.wallpaper,
  )
  await select(theme)
  values = (await client.settings.get()).data!.values
  expect(resolveThemeSettings(values, 'light')['workbench.wallpaper']).toEqual({
    enabled: true,
    source: { kind: 'desktop' },
  })
  const reset = await client.settings.write.post({
    mutationId: 'theme-reset',
    target: 'user',
    operations: [{ kind: 'theme.reset', id: theme.id }],
  })
  expect(reset.error).toBeNull()
  expect(
    themeVariants(theme, reset.data!.snapshot.values['workbench.theme.customizations']),
  ).toEqual(theme.variants)
  const duplicate = await client.settings.write.post({
    mutationId: 'theme-reset',
    target: 'user',
    operations: [{ kind: 'theme.reset', id: theme.id }],
  })
  expect(duplicate.data?.duplicate).toBe(true)

  // The studio's Apply: one write that selects the theme and replaces its whole customization.
  const replaced = await client.settings.write.post({
    mutationId: 'theme-replace',
    target: 'user',
    operations: [
      { kind: 'set', key: 'workbench.theme', value: theme },
      { kind: 'theme.reset', id: theme.id, to: { dark: { material: { blur: 5 } } } },
    ],
  })
  expect(replaced.error).toBeNull()
  expect(replaced.data!.snapshot.values['workbench.theme.customizations'][theme.id]).toEqual({
    dark: { material: { blur: 5 } },
  })
})

test('round trips artwork into an empty library without the source machine', async ({ client }) => {
  const upload = await client.themes.wallpapers.post({
    file: new File([wallpaperPng()], 'day.png'),
  })
  expect(upload.error).toBeNull()
  const input = themeDocument('portable-theme')
  input.variants.light.wallpaper = {
    enabled: true,
    source: { kind: 'library', asset: upload.data!.id },
  }
  expect((await client.themes.bundles.post(input)).error).toBeNull()
  const archive = await client.themes.bundles({ id: input.id }).export.get()
  expect(archive.error).toBeNull()
  expect(archive.data?.wallpapers).toHaveLength(1)
  const destination = await makeTestServer()
  try {
    const target = createInProcessClient(destination)
    const imported = await target.themes.bundles.import.post(archive.data)
    expect(imported.error).toBeNull()
    expect(imported.data?.variants).toEqual(input.variants)
    expect((await target.themes.wallpapers.get()).data?.assets).toHaveLength(1)
    const response = await destination.app.handle(
      new Request(`http://localhost/themes/wallpapers/${upload.data!.id}/asset`, {
        headers: { origin: destination.origin },
      }),
    )
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(wallpaperPng())
  } finally {
    await destination.cleanup()
  }
})

test('rejects partial archives and traversal without publishing parts', async ({
  client,
  server,
}) => {
  const upload = await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'a.png') })
  const input = themeDocument('broken-import')
  input.variants.dark.wallpaper = {
    enabled: true,
    source: { kind: 'library', asset: upload.data!.id },
  }
  const result = await client.themes.bundles.import.post({
    format: 'platform-theme',
    version: 1,
    theme: input,
    palettes: [],
    wallpapers: [
      { id: upload.data!.id, name: 'a.png', base64: Buffer.from('bad').toString('base64') },
    ],
    notices: [],
  })
  expect(result.status).toBe(400)
  expect(await readdir(path.join(server.root, '.platform/themes'))).toEqual([])
  expect((await client.themes.bundles.post({ ...input, id: '../escape' })).status).toBe(400)
})

test('keeps workspace and policy overrides above bundle defaults', async ({ client }) => {
  const theme = (await client.themes.bundles.post(themeDocument())).data!
  const saved = await client.settings.write.post({
    mutationId: 'scope-bundle',
    target: 'user',
    operations: [{ kind: 'set', key: 'workbench.theme', value: theme }],
  })
  const values = saved.data!.snapshot.values
  const resolved = resolveThemeSettings(values, 'dark', [
    { id: 'workspace', raw: { 'workbench.surface.blur': 12, 'workbench.palette': 'sage' } },
    { id: 'policy', raw: { 'workbench.surface.opacity': 100 } },
  ])
  expect(resolved['workbench.surface.blur']).toBe(12)
  expect(resolved['workbench.surface.opacity']).toBe(100)
  expect(resolved['workbench.palette']).toBe('graphite')
})

test('imports private palette data under a content identity and refuses incomplete archives', async ({
  client,
}) => {
  const { GRAPHITE_PALETTE_DOCUMENT } = await import('@workspace/contracts')
  const palette = { ...GRAPHITE_PALETTE_DOCUMENT, id: 'private-colors', name: 'Private colors' }
  expect((await client.themes.palettes.post(palette)).error).toBeNull()
  const input = themeDocument('private-bundle')
  input.variants.light.palette = palette.id
  expect((await client.themes.bundles.post(input)).error).toBeNull()
  expect((await client.themes.palettes({ id: palette.id }).delete.post()).error).not.toBeNull()
  const archive = (await client.themes.bundles({ id: input.id }).export.get()).data!
  expect(archive.palettes).toHaveLength(1)
  const destination = await makeTestServer()
  try {
    const target = createInProcessClient(destination)
    expect(
      (await target.themes.bundles.import.post({ ...archive, palettes: [] })).error,
    ).not.toBeNull()
    const imported = await target.themes.bundles.import.post(archive)
    expect(imported.error).toBeNull()
    const id = imported.data!.variants.light.palette
    expect(id).toMatch(/^import-/)
    const colors = await target.themes.palettes({ id }).get()
    expect(colors.error).toBeNull()
    expect(colors.data?.variants.kind).toBe('paired')
    const catalog = (await target.themes.palettes.get()).data!.palettes
    expect(catalog.find((palette) => palette.id === id)?.source).toBe('theme')
    expect((await target.themes.palettes.post(colors.data!)).status).toBe(409)
    expect(
      (await target.themes.bundles({ id: imported.data!.id }).export.get()).data?.palettes,
    ).toHaveLength(1)
  } finally {
    await destination.cleanup()
  }
})

test('every bundled variant meets the palette editor contrast readout', () => {
  for (const theme of BUNDLED_THEMES) {
    for (const mode of ['light', 'dark'] as const) {
      const palette = bundledPalette(theme.variants[mode].palette)!
      expect(contrastFailures(paletteColorsFor(palette, mode)), `${theme.name} ${mode}`).toEqual([])
    }
  }
})

test('rejects an empty import with the structured bundle error', async ({ client }) => {
  const response = await client.themes.bundles.import.post(undefined)
  expect(response.status).toBe(400)
  expect(response.error?.value).toMatchObject({ error: { code: 'themes.BUNDLE_INVALID' } })
})

test('keeps imported notices when exporting again', async ({ client }) => {
  const notices = ['Artwork: Example artist, CC BY 4.0', 'Palette mapping notes']
  const imported = await client.themes.bundles.import.post({
    format: 'platform-theme',
    version: 1,
    theme: themeDocument('notices'),
    palettes: [],
    wallpapers: [],
    notices,
  })
  expect(imported.error).toBeNull()
  const exported = await client.themes.bundles({ id: imported.data!.id }).export.get()
  expect(exported.data?.notices).toEqual(notices)
})

test('protects imported artwork referenced by another bundle default beneath a customization', async ({
  client,
}) => {
  const bytes = wallpaperPng()
  const { createHash } = await import('node:crypto')
  const asset = createHash('sha256').update(bytes).digest('hex')
  const document = themeDocument('artwork-owner')
  const uploaded = await client.themes.wallpapers.post({ file: new File([bytes], 'image.png') })
  document.variants.light.wallpaper = {
    enabled: true,
    source: { kind: 'library', asset: uploaded.data!.id },
  }
  await client.themes.wallpapers({ id: asset }).delete.post()
  const imported = await client.themes.bundles.import.post({
    format: 'platform-theme',
    version: 1,
    theme: document,
    palettes: [],
    wallpapers: [{ id: asset, name: 'image.png', base64: bytes.toString('base64') }],
    notices: [],
  })
  expect(imported.error).toBeNull()
  const dependent = await client.themes.bundles.post({ ...document, id: 'artwork-dependent' })
  expect(dependent.error).toBeNull()
  await client.settings.write.post({
    mutationId: 'hide-reference',
    target: 'user',
    operations: [
      {
        kind: 'theme.customize',
        id: dependent.data!.id,
        mode: 'light',
        patch: { wallpaper: { enabled: false, source: { kind: 'desktop' } } },
      },
    ],
  })
  expect((await client.themes.bundles({ id: imported.data!.id }).delete.post()).status).toBe(400)
  expect(
    (await client.themes.wallpapers.get()).data?.assets.some((entry) => entry.id === asset),
  ).toBe(true)
  expect((await client.themes.bundles({ id: dependent.data!.id }).delete.post()).status).toBe(200)
  await client.settings.write.post({
    mutationId: 'standalone-reference',
    target: 'user',
    operations: [
      { kind: 'set', key: 'workbench.wallpaper', value: document.variants.light.wallpaper },
    ],
  })
  expect((await client.themes.bundles({ id: imported.data!.id }).delete.post()).status).toBe(400)
  await client.settings.write.post({
    mutationId: 'clear-standalone-reference',
    target: 'user',
    operations: [{ kind: 'reset', keys: ['workbench.wallpaper'] }],
  })
  expect((await client.themes.bundles({ id: imported.data!.id }).delete.post()).status).toBe(200)
})
