import { expect, test } from 'vitest'
import { appearanceFailures, inspectAppearance } from './live-appearance.mjs'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

test('the live check accepts wallpaper off and rejects an unwanted preload', () => {
  expect(appearanceFailures({ kind: 'app', image: null, preloads: [] })).toEqual([])
  expect(appearanceFailures({ kind: 'app', image: null, preloads: [{}] })).not.toEqual([])
})

test.each([null, 'pairing'])('the live check rejects bootstrap kind %s', (kind) => {
  expect(appearanceFailures({ kind })).not.toEqual([])
})

test('the live check requires the selected image, request mode and decoder handoff', () => {
  const image = { href: 'https://example.test/image.png', crossOrigin: 'anonymous' }
  const preload = { ...image, imageSource: image.href }
  expect(appearanceFailures({ kind: 'app', image, preloads: [preload] })).toEqual([])
  for (const preloads of [[], [preload, preload]])
    expect(appearanceFailures({ kind: 'app', image, preloads })).not.toEqual([])
  for (const change of [
    { href: 'https://example.test/other.png' },
    { crossOrigin: '' },
    { imageSource: null },
  ])
    expect(
      appearanceFailures({ kind: 'app', image, preloads: [{ ...preload, ...change }] }),
    ).not.toEqual([])
})

test.skipIf(!existsSync(chromium.executablePath())).each(['light', 'dark'])(
  'the browser inspector selects the active %s system preload (requires installed Chromium)',
  async (mode) => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ colorScheme: mode })
      await page.route('https://example.test/**', (route) => route.abort())
      await page.setContent('<!doctype html><html><head></head><body></body></html>')
      await page.evaluate(bootstrapDocument)
      const result = await page.evaluate(inspectAppearance)
      expect(result.image.href).toBe(`https://example.test/${mode}.png`)
      expect(result.preloads).toHaveLength(1)
      expect(appearanceFailures(result)).toEqual([])
    } finally {
      await browser.close()
    }
  },
)

function bootstrapDocument() {
  const variants = Object.fromEntries(
    ['light', 'dark'].map((name) => [
      name,
      {
        image: { href: `https://example.test/${name}.png`, crossOrigin: 'anonymous' },
      },
    ]),
  )
  window.platformHtmlBootstrap = { value: { kind: 'app', colorMode: 'system', variants } }
  for (const name of ['light', 'dark']) {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.media = `(prefers-color-scheme: ${name})`
    link.href = variants[name].image.href
    link.crossOrigin = 'anonymous'
    link.platformWallpaperImage = { src: link.href }
    document.head.append(link)
  }
}
