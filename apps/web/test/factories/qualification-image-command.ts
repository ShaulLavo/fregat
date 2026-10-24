import { readFile } from 'node:fs/promises'
import type { Page, Route } from 'playwright'

export type ImageHttpMock =
  | {
      readonly action: 'install'
      readonly urls: readonly string[]
      readonly response: 'image' | 'missing'
    }
  | { readonly action: 'remove' }

type InstalledRoute = {
  readonly matcher: (url: URL) => boolean
  readonly handler: (route: Route) => Promise<void>
}

const installed = new WeakMap<Page, InstalledRoute>()

export async function mockQualificationImages(
  context: { readonly page: Page },
  input: ImageHttpMock,
): Promise<void> {
  const previous = installed.get(context.page)
  if (previous) {
    await context.page.unroute(previous.matcher, previous.handler)
    installed.delete(context.page)
  }
  if (input.action === 'remove') return
  const urls = new Set(input.urls)
  const png = await readFile(new URL('../../public/icons/icon-192.png', import.meta.url))
  const matcher = (url: URL) => urls.has(url.href)
  const handler = async (route: Route) => {
    if (input.response === 'missing') {
      await route.fulfill({
        status: 404,
        contentType: 'text/plain',
        body: 'Fixture image unavailable',
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: png,
      headers: { 'cache-control': 'no-store' },
    })
  }
  installed.set(context.page, { matcher, handler })
  await context.page.route(matcher, handler)
}
