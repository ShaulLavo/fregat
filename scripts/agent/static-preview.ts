import { realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Page } from 'playwright'

import { createScriptError } from '../structured-errors'

export const STATIC_PREVIEW_URL = 'http://fregat-preview.test/fregat/'

export async function routeStaticPreview(page: Page, directory: string) {
  const root = await realpath(resolve(directory))
  if (!(await stat(root)).isDirectory())
    throw createScriptError('--static-dir must be a directory.')
  await page.route('http://fregat-preview.test/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const relative = decodeURIComponent(pathname)
      .replace(/^\/fregat\/?/, '')
      .replace(/^\/+/, '')
    const candidate = resolve(root, relative || 'index.html')
    const path = await realpath(candidate).catch(() => null)
    if (!path || (path !== root && !path.startsWith(`${root}${sep}`))) {
      await route.fulfill({ status: 404, body: 'Not found' })
      return
    }
    const file = Bun.file(path)
    if (!(await stat(path)).isFile()) {
      await route.fulfill({ status: 404, body: 'Not found' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: file.type,
      body: Buffer.from(await file.arrayBuffer()),
    })
  })
  return root
}

export async function openStaticPreview(page: Page, url = STATIC_PREVIEW_URL) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  try {
    await page.getByRole('main').first().waitFor({ timeout: 30_000 })
    await page.evaluate('document.fonts.ready')
    await page.waitForTimeout(500)
    await page.evaluate('Promise.all(Array.from(document.images, image => image.decode()))')
    return true
  } catch {
    return false
  }
}

export async function staticPreviewLayout(page: Page) {
  return page.evaluate(`({
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    images: Array.from(document.images, image => ({
      alt: image.alt,
      source: image.currentSrc,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      bounds: image.getBoundingClientRect().toJSON()
    }))
  })`)
}
