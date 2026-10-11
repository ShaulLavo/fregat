import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { visit } from 'unist-util-visit'
import { fromHtml } from 'hast-util-from-html'
export type HtmlRoot = ReturnType<typeof fromHtml>
type Element = Extract<HtmlRoot['children'][number], { type: 'element' }>
import { fenceLanguage } from './languages'

type ExamplePaint = { paint: string; html: Record<number, string> }
export type ExampleCapture = { light: ExamplePaint; dark: ExamplePaint }
const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
const cache = new Map<string, Promise<ExampleCapture>>()
async function captureExample(text: string, language: string): Promise<ExampleCapture> {
  const id = fenceLanguage(language) ?? 'text'
  const input = JSON.stringify({ text, language: id })
  let result = cache.get(input)
  if (!result) {
    result = (async () => {
      const endpoint = JSON.parse(readFileSync(resolve('.capture/endpoint.json'), 'utf8')) as string
      const response = await fetch(endpoint, { method: 'POST', body: input })
      if (!response.ok) throw new TypeError(await response.text())
      return response.json() as Promise<ExampleCapture>
    })()
    cache.set(input, result)
  }
  return result
}
export async function renderExample(text: string, language: string): Promise<string> {
  const capture = await captureExample(text, language)
  const payload = inlineJson({
    text,
    language: fenceLanguage(language) ?? 'text',
    light: { paint: capture.light.paint },
    dark: { paint: capture.dark.paint },
  })
  const variants = Object.keys(capture.light.html)
    .map(Number)
    .map(
      (width) =>
        `<div data-example-width="${width}"${width === 752 ? '' : ' data-pagefind-ignore'}>${(
          ['light', 'dark'] as const
        )
          .map(
            (theme) =>
              `<div data-example-theme="${theme}"${theme === 'dark' ? ' data-pagefind-ignore' : ''}>${capture[theme].html[width]}</div>`,
          )
          .join('')}</div>`,
    )
    .join('')
  return `<figure class="not-content" data-example aria-label="${escape(language || 'Text')} code example"><script type="application/json" data-example-source>${payload}</script><div class="example-stage"><div class="example-static">${variants}</div></div><figcaption><span>${escape(language || 'Text')} example</span><button type="button" class="make-live" aria-label="Edit ${escape(language || 'text')} example" hidden>Make live</button><span class="example-status" role="status"></span></figcaption></figure>`
}
export function examplePaint() {
  return async (tree: HtmlRoot) => {
    const blocks: { node: Element; text: string; language: string }[] = []
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'pre') return
      const code = node.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      )
      if (!code) return
      const text = code.children
        .map((child) => (child.type === 'text' ? child.value : ''))
        .join('')
        .replace(/\n$/, '')
      const classes = Array.isArray(code.properties.className) ? code.properties.className : []
      const language = String(
        classes.find((name) => String(name).startsWith('language-')) ?? '',
      ).replace('language-', '')
      blocks.push({ node, text, language })
    })
    for (const block of blocks) {
      const html = await renderExample(block.text, block.language)
      const replacement = fromHtml(html, { fragment: true }).children[0] as Element
      Object.assign(block.node, replacement)
    }
  }
}
