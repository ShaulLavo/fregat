import { expect, test } from 'vitest'
import { resolveDocsLink } from '../src/manual/links'
import { renderCode, renderMarkdown } from '../src/manual/render'

const pages = new Set(['start-here/introduction.md', 'start-here/quick-start.md'])
const resolve = (href: string) =>
  resolveDocsLink('start-here/quick-start.md', href, '/singapore/', pages)

test('maps Markdown links to page URLs and marks the pages the editor opens', () => {
  expect(resolve('introduction.md')).toEqual({
    href: '/singapore/docs/start-here/introduction/',
    md: 'start-here/introduction.md',
  })
  expect(resolve('../guides/themes.mdx#tokens')).toEqual({
    href: '/singapore/docs/guides/themes/#tokens',
  })
  expect(resolve('/docs/reference/packages/')).toEqual({
    href: '/singapore/docs/reference/packages/',
  })
  expect(resolve('https://example.com/a.md')).toEqual({ href: 'https://example.com/a.md' })
})

test('renders one row per source line the way the live preview shows it', async () => {
  const page = await renderMarkdown(
    [
      '# Quick start',
      '',
      'Read the [introduction](introduction.md), then `npm` **docs**.',
      '',
      '## Install it',
      '',
      '- one-two/three',
      '',
      '```ts',
      'const answer: number = 42',
      '```',
    ].join('\n'),
    resolve,
  )
  expect(page.title).toBe('Quick start')
  expect(page.description).toBe('Read the introduction, then npm docs.')
  expect(page.lineCount).toBe(11)
  expect(page.headings.map(({ level, id, line }) => [level, id, line])).toEqual([
    [1, 'quick-start', 1],
    [2, 'install-it', 5],
  ])
  expect(page.html).toContain(
    '<h1 class="r h1" id="quick-start" data-n="1"><span class="s-keyword-declaration">Quick start</span></h1>',
  )
  expect(page.html).toContain(
    '<a href="/singapore/docs/start-here/introduction/" data-md="start-here/introduction.md" title="introduction.md">introduction</a>',
  )
  expect(page.html).toContain('<span class="s-string">npm</span>')
  expect(page.html).toContain(
    '<span aria-hidden="true">• </span><span class="nw">one-two/three</span>',
  )
  expect(page.html).toContain('<span class="r" data-n="9" aria-hidden="true"></span>')
  expect(page.html).toContain('<span class="s-keyword-declaration">const</span>')
  expect(page.html).not.toContain('```')
  expect(page.html).not.toContain('](')
})

test('rejects fences in languages the docs editor does not load', async () => {
  await expect(renderMarkdown('# Page\n\n```rust\nfn main() {}\n```\n', resolve)).rejects.toThrow(
    'no grammar for fence language "rust"',
  )
})

test('renders a source file as code rows', async () => {
  const rows = await renderCode('export const x = 1', 'typescript')
  expect(rows.lineCount).toBe(1)
  expect(rows.html).toContain('<span class="s-keyword-import">export</span>')
})
