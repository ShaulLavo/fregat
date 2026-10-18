import { scratchPath } from '../paths'
import { deepStrictEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openFileFromTree, runPaletteCommand } from '../selectors'
import type { Scenario } from './index'

// A 1×1 PNG and a small SVG, so every workspace image has something real to load.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#08f"/></svg>'

// The shapes README files use: a themed <picture>, root-relative and relative paths, raw HTML.
const README = [
  '<picture>',
  '  <source media="(prefers-color-scheme: light)" srcset="/docs/logo-light.svg">',
  '  <img alt="themed logo" src="/docs/logo-dark.svg" width="50%">',
  '</picture>',
  '',
  '# Images',
  '',
  '![relative](img/pixel.png)',
  '',
  '<img alt="raw html" src="./img/pixel.png">',
  '',
].join('\n')

type Loaded = { readonly alt: string; readonly loaded: boolean; readonly source: string }

async function images(page: Page): Promise<Loaded[]> {
  await page.waitForTimeout(1500)
  return page.locator('[data-markdown-preview] img').evaluateAll((list) =>
    (list as HTMLImageElement[]).map((image) => ({
      alt: image.alt,
      loaded: image.complete && image.naturalWidth > 0,
      source: image.currentSrc.replace(/^https?:\/\/[^/]+/u, ''),
    })),
  )
}

const reports = new WeakMap<Page, unknown>()

export const markdownPreviewImages: Scenario = {
  name: 'markdown-preview-images',
  description:
    'Open a README with a themed <picture>, Markdown and raw HTML images in the rendered pane, in light and dark: every workspace image loads.',
  inspect: async (page) => reports.get(page),
  async run(page, { step }) {
    const fixture = await mkdtemp(scratchPath('fregat-markdown-images-'))
    try {
      await mkdir(path.join(fixture, 'docs'))
      await mkdir(path.join(fixture, 'img'))
      await writeFile(path.join(fixture, 'docs', 'logo-light.svg'), SVG)
      await writeFile(path.join(fixture, 'docs', 'logo-dark.svg'), SVG)
      await writeFile(path.join(fixture, 'img', 'pixel.png'), PIXEL)
      await writeFile(path.join(fixture, 'README.md'), README)
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'README.md')
      await runPaletteCommand(page, 'Toggle Markdown rendered pane')
      await page.locator('[data-markdown-preview] h1').waitFor()

      await page.emulateMedia({ colorScheme: 'light' })
      const light = await images(page)
      await step('light')
      await page.emulateMedia({ colorScheme: 'dark' })
      const dark = await images(page)
      await step('dark')
      reports.set(page, { light, dark })

      const every = (list: readonly Loaded[]) => list.map((image) => [image.alt, image.loaded])
      const expected = [
        ['themed logo', true],
        ['relative', true],
        ['raw html', true],
      ]
      deepStrictEqual(every(light), expected, 'every image loads in light mode')
      deepStrictEqual(every(dark), expected, 'every image loads in dark mode')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
