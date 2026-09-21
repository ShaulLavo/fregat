import type { Page } from 'playwright'

/**
 * The API the page talks to, with no trailing slash, plus the origin header it must carry.
 * `preserveAppearance` and the wallpaper scenarios build a slash-terminated base of their own;
 * that is a different string, not a copy of this one.
 */
export function serverApi(page: Page) {
  const url = new URL(page.url())
  const base = url.pathname.startsWith('/platform/')
    ? `${url.origin}/platform`
    : `http://localhost:${process.env.PORT ?? '3001'}`
  return { base, headers: { origin: url.origin } }
}
