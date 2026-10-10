import { realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Locator, Page } from 'playwright'

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
    await waitForStaticPreviewImages(page)
    return true
  } catch {
    return false
  }
}

async function waitForStaticPreviewImages(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images, async (image) => {
        const bounds = image.getBoundingClientRect()
        const inViewport =
          bounds.bottom > 0 &&
          bounds.right > 0 &&
          bounds.top < innerHeight &&
          bounds.left < innerWidth
        // Offscreen lazy images can leave decode pending; currentSrc can already be selected.
        if (image.loading === 'lazy' && !image.complete && !inViewport) return
        // A newly visible lazy image can select its source after scrolling, aborting an early decode.
        if (!image.complete) {
          await new Promise<void>((resolve) => {
            const settled = () => {
              image.removeEventListener('load', settled)
              image.removeEventListener('error', settled)
              resolve()
            }
            image.addEventListener('load', settled)
            image.addEventListener('error', settled)
          })
        }
        return image.decode()
      }),
    ),
  )
}

export async function captureStaticPreview(page: Page, target: Page | Locator, path?: string) {
  if ('scrollIntoViewIfNeeded' in target) await target.scrollIntoViewIfNeeded()
  await waitForStaticPreviewImages(page)
  return target.screenshot({ path })
}

export async function staticPreviewLayout(page: Page) {
  return page.evaluate(`({
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    frames: Array.from(document.querySelectorAll('iframe'), frame => ({
      title: frame.title,
      source: frame.src,
      bounds: frame.getBoundingClientRect().toJSON(),
      busy: frame.parentElement?.getAttribute('aria-busy')
    })),
    images: Array.from(document.images, image => ({
      alt: image.alt,
      source: image.currentSrc,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      bounds: image.getBoundingClientRect().toJSON()
    }))
  })`)
}
