import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'

const publicRoot = path.resolve(import.meta.dirname, '../../../../web/public')
const manifest = JSON.parse(readFileSync(path.join(publicRoot, 'manifest.webmanifest'), 'utf8'))

test('installed Fregat identity preserves the production base and launch policy', () => {
  expect(manifest).toMatchObject({
    id: './',
    name: 'Fregat',
    short_name: 'Fregat',
    start_url: './',
    scope: './',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    launch_handler: { client_mode: 'focus-existing' },
  })
  const manifestUrl = 'https://example.test/platform/manifest.webmanifest'
  expect(new URL(manifest.id, manifestUrl).href).toBe('https://example.test/platform/')
})

test('installed app preserves scalable artwork and existing raster registrations', () => {
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: 'icons/fregat.svg', sizes: 'any', type: 'image/svg+xml' }),
      expect.objectContaining({ src: 'icons/icon-192.png', sizes: '192x192' }),
      expect.objectContaining({ src: 'icons/icon-512.png', sizes: '512x512' }),
      expect.objectContaining({ src: 'icons/icon-maskable-512.png', purpose: 'maskable' }),
    ]),
  )
  for (const icon of manifest.icons) {
    expect(readFileSync(path.join(publicRoot, icon.src)).length).toBeGreaterThan(0)
  }
})
