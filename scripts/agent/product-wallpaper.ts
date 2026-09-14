import { resolve } from 'node:path'
import type { Page, Route } from 'playwright'

import { createScriptError } from '../structured-errors'
import type { Evidence } from './evidence'
import { selectors } from './selectors'

const PRODUCT_SETTINGS = {
  'workbench.wallpaper.enabled': true,
  'workbench.surface.opacity': 82,
  'workbench.surface.contentOpacity': 88,
}

export async function routeProductWallpaper(page: Page, path: string, evidence: Evidence) {
  const source = resolve(path)
  const file = Bun.file(source)
  if (!(await file.exists()) || !file.type.startsWith('image/'))
    throw createScriptError('--product-wallpaper must name an existing image file.')
  const body = Buffer.from(await file.arrayBuffer())
  const requests: {
    url: string
    method: string
    override: string
    status?: number
    shape?: string
  }[] = []
  await page.addInitScript(
    `localStorage.setItem('platform.settings-boot-mirror.v1', ${JSON.stringify(JSON.stringify(PRODUCT_SETTINGS))})`,
  )
  await page.addInitScript(`{
    const data = navigator.userAgentData;
    if (data) Object.defineProperty(data, 'platform', { get: () => 'Windows' });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
  }`)
  await page.route(
    /\/(?:wallpaper(?:\/info|\/still)?|workbench\/wallpaper\.jpg)(?:\?.*)?$/,
    async (route) => {
      const request = route.request()
      requests.push({ url: request.url(), method: request.method(), override: 'still image' })
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'cache-control': 'no-store',
      }
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers })
        return
      }
      if (new URL(request.url()).pathname.endsWith('/info')) {
        await route.fulfill({ json: { contentType: file.type }, headers })
        return
      }
      await route.fulfill({
        contentType: file.type,
        body: request.method() === 'HEAD' ? '' : body,
        headers,
      })
    },
  )
  await page.route(/\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const result = await overrideSettings(route)
    requests.push({ url: route.request().url(), method: 'GET', ...result })
  })
  return async () =>
    evidence.json('product-wallpaper.json', {
      source,
      settings: PRODUCT_SETTINGS,
      browser: await page.evaluate(
        `({ userAgent: navigator.userAgent, platform: navigator.platform, userAgentDataPlatform: navigator.userAgentData?.platform ?? null, backdrop: document.documentElement.getAttribute('data-backdrop') })`,
      ),
      persistence: 'fresh Playwright context only; server settings unchanged',
      requests,
    })
}

async function overrideSettings(route: Route) {
  const response = await route.fetch({
    headers: {
      ...(await route.request().allHeaders()),
      origin: new URL(route.request().url()).origin,
    },
  })
  const snapshot: unknown = await response.json().catch(() => null)
  const result = {
    status: response.status(),
    shape:
      snapshot && typeof snapshot === 'object' ? Object.keys(snapshot).join(', ') : typeof snapshot,
    override: 'unchanged response',
  }
  if (
    !response.ok() ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    !('values' in snapshot) ||
    !snapshot.values ||
    typeof snapshot.values !== 'object'
  ) {
    await route.fulfill({ response })
    return result
  }
  await route.fulfill({
    response,
    json: { ...snapshot, values: { ...snapshot.values, ...PRODUCT_SETTINGS } },
  })
  return { ...result, override: 'appearance values' }
}

export async function alignProductWallpaper(page: Page, evidence: Evidence) {
  const viewport = page.viewportSize()
  if (viewport?.width !== 1360 || viewport.height !== 840)
    throw createScriptError('Product wallpaper composition requires --width 1360 --height 840.')
  const toolbar = await selectors.windowToolbar(page).boundingBox()
  if (!toolbar) throw createScriptError('Product capture requires the real window toolbar.')
  const toolbarHeight = toolbar.height
  const css = `:root { --surface-opacity: 82% !important; --content-opacity: 88% !important; }
[data-workbench] img[data-workbench-wallpaper-layer] { width: 1600px !important; height: 1000px !important; max-width: none !important; left: -120px !important; top: -${80 + toolbarHeight}px !important; right: auto !important; bottom: auto !important; object-fit: cover !important; }
[data-workbench] video[data-workbench-wallpaper-layer] { display: none !important; }`
  await page.addStyleTag({ content: css })
  await evidence.json('product-composition.json', {
    stage: { width: 1600, height: 1000 },
    frame: { x: 120, y: 80, width: 1360, height: 840 },
    toolbarHeight,
    wallpaperOffset: { x: -120, y: -(80 + toolbarHeight) },
    css,
  })
}
