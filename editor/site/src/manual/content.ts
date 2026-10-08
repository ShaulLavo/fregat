/** Build-time index of the docs pages written as plain Markdown. */
import { resolveDocsLink, type ManualPage } from './links'
import { renderMarkdown } from './render'
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

export const MANUAL_PAGES: readonly ManualPage[] = [...MANUAL_SOURCES].map(([file, text]) => ({
  file,
  url: pageUrl(file.replace(/\.md$/, '')),
  source: `${base}docs/${file}`,
  title: text.match(/^# (.+)$/m)?.[1] ?? file,
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
  const text = MANUAL_SOURCES.get(file)
  if (text === undefined) throw new TypeError(`No docs page ${file}`)
  return renderMarkdown(text, (href) => resolveDocsLink(file, href, base, files)).catch(
    (error: unknown) => {
      throw new TypeError(`Rendering docs/${file} failed`, { cause: error })
    },
  )
}
