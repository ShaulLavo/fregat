import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import { examplePaint, type HtmlRoot } from './examples'
import { visit } from 'unist-util-visit'

export type LinkTarget = { readonly href: string; readonly md?: string }

export async function renderMarkdown(text: string, resolveLink: (href: string) => LinkTarget) {
  const links = () => (tree: HtmlRoot) => {
    visit(tree, 'element', (node) => {
      if (/^h[1-6]$/.test(node.tagName)) node.properties['data-pagefind-weight'] = '10'
      if (node.tagName === 'a' && typeof node.properties.href === 'string')
        node.properties.href = resolveLink(node.properties.href).href
    })
  }
  const processor = await createMarkdownProcessor({
    syntaxHighlight: false,
    rehypePlugins: [links, examplePaint],
  })
  const page = await processor.render(text)
  const title = text.match(/^# (.+)$/m)?.[1]
  if (!title) throw new TypeError('A docs page starts with a level-one heading')
  const description = text.split('\n').find((line) => line.trim() && !line.startsWith('#')) ?? title
  return { html: page.code, title, description, headings: page.metadata.headings }
}
