import {
  HTML_BOOTSTRAP_ID,
  HTML_BOOTSTRAP_PALETTE_ID,
  HTML_BOOTSTRAP_WALLPAPER_IDS,
  type ColorMode,
  type HtmlBootstrap,
} from '@workspace/contracts'
import type { AppearanceBootstrap } from './appearance-bootstrap'
import { webErrors } from './structured-errors'

type Preload = Readonly<{ href: string; media: string | null }>

export async function renderHtmlBootstrap(
  document: Response,
  bootstrap: AppearanceBootstrap,
): Promise<Response> {
  const counts = new Map<string, number>()
  const preloads = wallpaperPreloads(bootstrap.payload)
  const rewriter = new HTMLRewriter()
    .on(`#${HTML_BOOTSTRAP_ID}`, {
      element(element) {
        count(counts, HTML_BOOTSTRAP_ID)
        assertTag(element, 'script', HTML_BOOTSTRAP_ID)
        element.setAttribute('type', 'application/json')
        element.setInnerContent(JSON.stringify(bootstrap.payload).replaceAll('<', '\\u003c'), {
          html: true,
        })
      },
    })
    .on(`#${HTML_BOOTSTRAP_PALETTE_ID}`, {
      element(element) {
        count(counts, HTML_BOOTSTRAP_PALETTE_ID)
        assertTag(element, 'style', HTML_BOOTSTRAP_PALETTE_ID)
        if (bootstrap.payload.kind === 'pairing') {
          element.remove()
          return
        }
        element.setInnerContent(bootstrap.paletteCSS, { html: true })
      },
    })
  for (const mode of ['light', 'dark'] as const) {
    const id = HTML_BOOTSTRAP_WALLPAPER_IDS[mode]
    rewriter.on(`#${id}`, {
      element(element) {
        count(counts, id)
        assertTag(element, 'link', id)
        const preload = preloads[mode]
        if (!preload) {
          element.remove()
          return
        }
        element.setAttribute('rel', 'preload')
        element.setAttribute('as', 'image')
        element.setAttribute('href', preload.href)
        element.setAttribute('crossorigin', 'anonymous')
        element.setAttribute('fetchpriority', 'high')
        if (preload.media) element.setAttribute('media', preload.media)
        if (!preload.media) element.removeAttribute('media')
      },
    })
  }
  const body = await rewriter.transform(document).text()
  for (const id of [HTML_BOOTSTRAP_ID, HTML_BOOTSTRAP_PALETTE_ID].concat(
    Object.values(HTML_BOOTSTRAP_WALLPAPER_IDS),
  )) {
    const found = counts.get(id) ?? 0
    if (found !== 1)
      throw webErrors.BOOTSTRAP_TEMPLATE_INVALID({ internal: { element: id, found, expected: 1 } })
  }
  const headers = new Headers(document.headers)
  headers.set('cache-control', 'private, no-store')
  headers.set('content-type', 'text/html; charset=utf-8')
  headers.delete('content-length')
  headers.delete('etag')
  return new Response(body, { status: document.status, headers })
}

function count(counts: Map<string, number>, id: string) {
  counts.set(id, (counts.get(id) ?? 0) + 1)
}

function assertTag(element: HTMLRewriterTypes.Element, tag: string, id: string) {
  if (element.tagName !== tag)
    throw webErrors.BOOTSTRAP_TEMPLATE_INVALID({
      internal: { element: id, tag: element.tagName, expectedTag: tag },
    })
}

function wallpaperPreloads(payload: HtmlBootstrap): Partial<Record<ColorMode, Preload>> {
  if (payload.kind === 'pairing') return {}
  if (payload.colorMode !== 'system') {
    const image = payload.variants[payload.colorMode].image
    return image ? { [payload.colorMode]: { href: image.href, media: null } } : {}
  }
  const light = payload.variants.light.image
  const dark = payload.variants.dark.image
  if (light && dark && light.href === dark.href) return { light: { href: light.href, media: null } }
  return {
    ...(light ? { light: { href: light.href, media: '(prefers-color-scheme: light)' } } : {}),
    ...(dark ? { dark: { href: dark.href, media: '(prefers-color-scheme: dark)' } } : {}),
  }
}
