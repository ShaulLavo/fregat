/** Build-time index of the docs pages written as plain Markdown. */
import { resolveDocsLink, type ManualPage } from './links'
import { capturedDocument, type CapturedDocument } from './captured'
import { SECTIONS } from './sections'

const sources = import.meta.glob<string>('../content/docs/docs/{start-here,guides,concepts}/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/')

/** Markdown path under `docs/`, such as `start-here/quick-start.md`, to its text. */
export const MANUAL_SOURCES = new Map(
  Object.entries(sources).map(([path, text]) => [path.replace('../content/docs/docs/', ''), text]),
)
const files = new Set(MANUAL_SOURCES.keys())

const pageUrl = (slug: string) => `${base}docs/${slug}/`

export const MANUAL_PAGES: readonly ManualPage[] = Array.from(MANUAL_SOURCES, ([file]) => ({
  file,
  url: pageUrl(file.replace(/\.md$/, '')),
  source: `${base}docs/${file}`,
  paint: `${base}docs/${file.replace(/\.md$/, '')}.paint.json`,
  title: capturedDocument(file).light.headings.find((heading) => heading.level === 1)?.name ?? file,
}))

export type NavSection = {
  readonly label: string
  readonly pages: readonly { readonly label: string; readonly href: string; readonly md?: string }[]
}

export const NAV: readonly NavSection[] = SECTIONS.map((section) => ({
  label: section.label,
  pages: section.pages.map(([slug, label]) => {
    const md = `${slug}.md`
    return files.has(md) ? { label, href: pageUrl(slug), md } : { label, href: pageUrl(slug) }
  }),
}))

export function renderPage(file: string) {
  const capture = capturedDocument(file)
  const resolve = (href: string) => resolveDocsLink(file, href, base, files).href
  const palette = (value: CapturedDocument['light']) => {
    const paint = JSON.parse(value.paint)
    for (const row of paint.rows)
      for (const run of row.runs) {
        if (run.href) run.href = resolve(run.href)
      }
    const links = (html: string) =>
      html.replace(
        /href="([^"]*)"/g,
        (_, href: string) =>
          `href="${resolve(href.replaceAll('&amp;', '&')).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`,
      )
    return {
      ...value,
      paint: JSON.stringify(paint),
      html: Object.fromEntries(
        Object.entries(value.html).map(([width, html]) => [width, links(html)]),
      ),
    }
  }
  const document = {
    text: capture.text,
    light: palette(capture.light),
    dark: palette(capture.dark),
  }
  return {
    ...document,
    title: document.light.headings.find((heading) => heading.level === 1)?.name ?? file,
    description: document.light.description,
  }
}
