import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import * as v from 'valibot'
import { afterEach, expect, test } from 'vitest'
import {
  DEFAULT_SETTING_VALUES,
  DEFAULT_APPEARANCE_BOOT_VALUES,
  APPEARANCE_BOOT_KEYS,
  assetIdSchema,
  GRAPHITE_PALETTE_DOCUMENT,
  HTML_BOOTSTRAP_ID,
  HTML_BOOTSTRAP_PALETTE_ID,
  HTML_BOOTSTRAP_WALLPAPER_IDS,
  environmentIdSchema,
  htmlBootstrapSchema,
  resolveThemeSettings,
  themeBundleSchema,
  type HtmlBootstrap,
} from '@workspace/contracts'
import { SettingsStore } from '../../settings/store'
import { PaletteLibrary } from '../../themes/palette-library'
import { createAppearanceBootstrap, documentBackdrop } from '../appearance-bootstrap'
import { renderHtmlBootstrap } from '../html-bootstrap'

const homes: string[] = []
const stores: SettingsStore[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) store.close()
  await Promise.all(homes.splice(0).map((home) => rm(home, { force: true, recursive: true })))
})

test('boot defaults match each registered appearance default', () => {
  for (const key of APPEARANCE_BOOT_KEYS)
    expect(DEFAULT_APPEARANCE_BOOT_VALUES[key], key).toEqual(DEFAULT_SETTING_VALUES[key])
})

test('preloads the selected static media with compatible CORS and configured base', async () => {
  const { settings, palettes, produce } = await harness()
  const asset = v.parse(assetIdSchema, 'a'.repeat(64))
  await settings.write({
    mutationId: 'image',
    target: 'user',
    operations: [
      { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: true, source: { kind: 'library', asset } },
      },
    ],
  })
  await palettes.create({ ...GRAPHITE_PALETTE_DOCUMENT, id: 'custom', name: 'Custom' })
  await settings.write({
    mutationId: 'palette',
    target: 'user',
    operations: [{ kind: 'set', key: 'workbench.palette', value: 'custom' }],
  })
  const bootstrap = await produce()
  expect(v.safeParse(htmlBootstrapSchema, bootstrap.payload).success).toBe(true)
  const html = await (await renderHtmlBootstrap(new Response(template()), bootstrap)).text()
  expect(html).toContain(`href="https://example.test/prefix/themes/wallpapers/${asset}/display"`)
  expect(html).toContain('crossorigin="anonymous"')
  expect(html).not.toContain('prefers-color-scheme')
  expect(html).not.toContain(HTML_BOOTSTRAP_WALLPAPER_IDS.light)
  if (bootstrap.payload.kind !== 'app') return
  expect(bootstrap.payload.variants.dark.palette.id).toBe('custom')
  expect(bootstrap.payload.variants.dark.palette.source).toBe('user')
  expect(bootstrap.paletteCSS).toContain(':root.dark')
})

test('normalizes theme customizations and layer overrides for both startup modes', async () => {
  const { settings, produce } = await harness()
  const material = { opacity: 20, contentOpacity: 35, blur: 3, saturation: 90 }
  const theme = v.parse(themeBundleSchema, {
    schemaVersion: 1,
    id: 'custom-theme',
    name: 'Custom theme',
    revision: '1',
    source: 'user',
    variants: {
      light: {
        palette: 'graphite',
        codeTheme: 'light-plus',
        wallpaper: { enabled: false, source: { kind: 'desktop' } },
        material,
      },
      dark: {
        palette: 'graphite',
        codeTheme: 'dark-plus',
        wallpaper: { enabled: true, source: { kind: 'desktop' } },
        material,
      },
    },
  })
  await settings.write({
    mutationId: 'theme',
    target: 'user',
    operations: [
      { kind: 'set', key: 'workbench.theme', value: theme },
      {
        kind: 'theme.customize',
        id: theme.id,
        mode: 'dark',
        patch: { material: { opacity: 65 } },
      },
    ],
  })
  const bootstrap = await produce()
  if (bootstrap.payload.kind !== 'app') return
  const { light, dark } = bootstrap.payload.variants
  expect(light.values['workbench.wallpaper'].enabled).toBe(false)
  expect(dark.values['workbench.surface.opacity']).toBe(65)
  expect(dark.values['workbench.theme.customizations']).toEqual({})
  expect(dark.values['workbench.colorTheme']).toBe('system')
  expect(resolveThemeSettings(dark.values, 'dark')).toEqual(dark.values)
  const html = await (await renderHtmlBootstrap(new Response(template()), bootstrap)).text()
  expect(html).not.toContain(HTML_BOOTSTRAP_WALLPAPER_IDS.light)
  expect(html).toContain('media="(prefers-color-scheme: dark)"')
})

test('deduplicates an identical image in system mode and omits off/native downloads', async () => {
  const { settings, produce } = await harness()
  const bootstrap = await produce()
  const html = await (await renderHtmlBootstrap(new Response(template()), bootstrap)).text()
  expect((html.match(/rel="preload"/gu) ?? []).length).toBe(1)
  expect(html).not.toContain('prefers-color-scheme')
  for (const backdrop of ['transparent', 'compositor'] as const) {
    const native = await produce(backdrop)
    const result = await (await renderHtmlBootstrap(new Response(template()), native)).text()
    expect(result).not.toContain('rel="preload"')
  }
  await settings.write({
    mutationId: 'off',
    target: 'user',
    operations: [
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: false, source: { kind: 'desktop' } },
      },
    ],
  })
  const off = await (await renderHtmlBootstrap(new Response(template()), await produce())).text()
  expect(off).not.toContain('wallpaper/still')
})

test('escapes JSON and rejects missing, duplicate or wrongly tagged template slots', async () => {
  const { produce } = await harness()
  const bootstrap = await produce()
  if (bootstrap.payload.kind !== 'app') return
  bootstrap.payload.variants.dark.palette.name = '</script><script>alert(1)</script>'
  const html = await (await renderHtmlBootstrap(new Response(template()), bootstrap)).text()
  expect(html).not.toContain('</script><script>alert(1)')
  expect(html).toContain('\\u003c/script>')
  for (const invalid of [
    template().replace(`<style id="${HTML_BOOTSTRAP_PALETTE_ID}"></style>`, ''),
    template().replace('</head>', `<style id="${HTML_BOOTSTRAP_PALETTE_ID}"></style></head>`),
    template().replace(
      `<style id="${HTML_BOOTSTRAP_PALETTE_ID}"></style>`,
      `<div id="${HTML_BOOTSTRAP_PALETTE_ID}"></div>`,
    ),
  ])
    await expect(renderHtmlBootstrap(new Response(invalid), bootstrap)).rejects.toMatchObject({
      code: 'web.BOOTSTRAP_TEMPLATE_INVALID',
    })
})

test('native request hints and viewing-platform hints select backdrop without server OS', () => {
  for (const backdrop of ['app', 'transparent', 'compositor'] as const) {
    expect(
      documentBackdrop(new Headers({ 'user-agent': `Mozilla/5.0 FregatBackdrop/${backdrop}` })),
    ).toBe(backdrop)
  }
  expect(documentBackdrop(new Headers({ 'user-agent': 'Mozilla/5.0 (Linux; Android 15)' }))).toBe(
    'app',
  )
  expect(documentBackdrop(new Headers({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)' }))).toBe(
    'compositor',
  )
  expect(
    documentBackdrop(new Headers({ 'sec-ch-ua-platform': '"Windows"', 'user-agent': 'Linux' })),
  ).toBe('app')
})

async function harness() {
  const home = await mkdtemp(path.join(tmpdir(), 'html-bootstrap-'))
  homes.push(home)
  const settings = new SettingsStore({
    userFilePath: path.join(home, 'settings.json'),
    secretsFilePath: path.join(home, 'secrets.json'),
    watch: false,
  })
  stores.push(settings)
  const palettes = new PaletteLibrary({ directory: path.join(home, 'palettes'), settings })
  const environmentId = v.parse(environmentIdSchema, '11111111-1111-4111-8111-111111111111')
  const produce = (backdrop: Extract<HtmlBootstrap, { kind: 'app' }>['backdrop'] = 'app') =>
    createAppearanceBootstrap({
      snapshot: settings.snapshot(),
      environmentId,
      apiBase: 'https://example.test/prefix/',
      backdrop,
      palettes,
    })
  return { settings, palettes, produce }
}

function template() {
  return `<html><head><script id="${HTML_BOOTSTRAP_ID}" type="application/json"></script><style id="${HTML_BOOTSTRAP_PALETTE_ID}"></style><link id="${HTML_BOOTSTRAP_WALLPAPER_IDS.light}"><link id="${HTML_BOOTSTRAP_WALLPAPER_IDS.dark}"></head><body></body></html>`
}
