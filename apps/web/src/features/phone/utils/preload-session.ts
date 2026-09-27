import { SHELL_CHUNKS_ID } from '@/lib/boot-keys'

/** The emitted closure lets browsers prepare modules without executing the conversation. */
export function preloadSession() {
  const source = document.getElementById(SHELL_CHUNKS_ID)?.textContent
  if (!source) return
  const manifest = JSON.parse(source) as Record<string, readonly string[]>
  const loaded = new Set(
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]'), (link) => link.href),
  )
  for (const href of manifest.session ?? []) {
    const url = new URL(href, location.href).href
    if (loaded.has(url)) continue
    const link = document.createElement('link')
    const style = href.endsWith('.css')
    link.rel = style ? 'preload' : 'modulepreload'
    if (style) link.as = 'style'
    link.crossOrigin = ''
    link.fetchPriority = 'low'
    link.dataset.phoneWarmSession = ''
    link.href = href
    document.head.append(link)
    loaded.add(url)
  }
}
