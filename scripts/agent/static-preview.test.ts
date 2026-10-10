import { test, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'
import { routeStaticPreview, STATIC_PREVIEW_URL } from './static-preview'

test.skipIf(!existsSync(chromium.executablePath()))(
  'static product previews provide secure browser APIs and root-relative assets',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fregat-static-preview-'))
    const browser = await chromium.launch({ channel: 'chromium' })
    try {
      await writeFile(join(directory, 'index.html'), '<main>Captured page</main>')
      await writeFile(join(directory, 'asset.txt'), 'Root asset')
      const page = await browser.newPage()
      await routeStaticPreview(page, directory)
      await page.goto(STATIC_PREVIEW_URL)
      expect(await page.getByRole('main').innerText()).toBe('Captured page')
      expect(
        await page.evaluate(async () => ({
          secure: isSecureContext,
          uuid: crypto.randomUUID().length,
          asset: await fetch('/asset.txt').then((response) => response.text()),
        })),
      ).toEqual({ secure: true, uuid: 36, asset: 'Root asset' })
      expect(
        await page.evaluate(() => fetch('/missing.txt').then((response) => response.status)),
      ).toBe(404)
    } finally {
      await browser.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
