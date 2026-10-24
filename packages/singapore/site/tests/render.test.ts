import { expect, test } from 'vitest'
import { resolveDocsLink } from '../src/manual/links'
import { renderMarkdown } from '../src/manual/render'

const pages = new Set(['start-here/introduction.md', 'start-here/quick-start.md'])
const resolve = (href: string) =>
  resolveDocsLink('start-here/quick-start.md', href, '/singapore/', pages)

test('maps Markdown links to normal page URLs', () => {
  expect(resolve('introduction.md').href).toBe('/singapore/docs/start-here/introduction/')
  expect(resolve('../guides/themes.mdx#tokens').href).toBe('/singapore/docs/guides/themes/#tokens')
  expect(resolve('https://example.com/a.md').href).toBe('https://example.com/a.md')
})
test('renders ordinary paragraphs, nested lists, emphasis and real table cells', async () => {
  const page = await renderMarkdown(
    '# Quick start\n\nRead the [introduction](introduction.md), then `npm` **docs**.\n\n## Install it\n\n- first\n  - nested\n\n| Name | Value |\n| --- | --- |\n| one | two |\n',
    resolve,
  )
  expect(page.title).toBe('Quick start')
  expect(page.headings.map(({ depth, slug }) => [depth, slug])).toEqual([
    [1, 'quick-start'],
    [2, 'install-it'],
  ])
  expect(page.html).toContain('<p>Read the <a href="/singapore/docs/start-here/introduction/">')
  expect(page.html).toContain('<strong>docs</strong>')
  expect(page.html).toContain('<td>two</td>')
  expect(page.html).not.toContain('data-n=')
})

test('authored headings carry search weight for title and heading matches', async () => {
  const page = await renderMarkdown('# Quick start\n\n## Open a named document\n', resolve)
  expect(page.html).toMatch(/<h1[^>]*data-pagefind-weight="10"/)
  expect(page.html).toMatch(/<h2[^>]*data-pagefind-weight="10"/)
})
