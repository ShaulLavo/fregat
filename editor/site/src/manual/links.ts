/** A docs page the editor can open: its Markdown path under `docs/`, URL and source URL. */
export type ManualPage = {
  readonly file: string
  readonly url: string
  readonly source: string
  readonly title: string
}

const ORIGIN = 'https://docs.invalid'

/**
 * Where a link in a docs page's Markdown goes. Relative `.md` links name other docs pages, as they
 * do on GitHub; `.mdx` links name pages Starlight still renders. Both become the page URL.
 */
export function resolveDocsLink(
  from: string,
  href: string,
  base: string,
  pages: ReadonlySet<string>,
): { readonly href: string; readonly md?: string } {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//'))
    return { href }
  const url = new URL(href, `${ORIGIN}/docs/${from}`)
  const prefix = base.replace(/\/$/, '')
  const page = url.pathname.match(/^\/docs\/(.+)\.mdx?$/)?.[1]
  if (!page) return { href: `${prefix}${url.pathname}${url.search}${url.hash}` }
  const target = `${prefix}/docs/${page}/${url.hash}`
  const md = `${page}.md`
  return pages.has(md) ? { href: target, md } : { href: target }
}
