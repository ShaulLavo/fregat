import { describe, expect, it } from 'vitest'
import type { EditorTheme } from '@singapore-editor/core/rendering'
import {
  createTooltipCodeTokenizer,
  normalizeTooltipMarkdown,
  renderTooltipMarkdown as renderLanguageServerTooltipMarkdown,
  type TooltipMarkdownRenderOptions,
} from '@singapore-editor/plugin-ui'

describe('tooltip Markdown rendering', () => {
  it('renders TypeScript fenced code blocks as pre/code', () => {
    const element = renderTooltipMarkdown(document, '```ts\nconst value: string\n```')
    const code = element.querySelector('pre > code')

    expect(code?.textContent).toBe('const value: string')
    expect(code?.getAttribute('data-language')).toBe('ts')
    expect(code?.querySelector('span')).toBeNull()
  })

  it('paints a fenced block with the tokens the editor hands back', async () => {
    const tokenizer = createTooltipCodeTokenizer({
      tokenize: async (_text, languageId) => [
        { start: 0, end: 5, style: { color: `var(--editor-syntax-${languageId})` } },
        { start: 6, end: 11, style: { color: 'rgb(1, 2, 3)', fontStyle: 'italic' } },
      ],
    })
    const markdown = '```rust\nconst value: string\n```'
    const first = renderTooltipMarkdown(document, markdown, undefined, { codeTokenizer: tokenizer })
    await tokenizer.tokenize('const value: string', 'rust')
    await Promise.resolve()

    const spans = [...first.querySelectorAll<HTMLElement>('pre > code > span')]
    expect(spans.map((span) => span.textContent)).toEqual(['const', 'value'])
    expect(spans[0]?.style.color).toBe('var(--editor-syntax-rust)')
    expect(spans[1]?.style.fontStyle).toBe('italic')
    expect(first.querySelector('code')?.textContent).toBe('const value: string')

    // A hover re-renders whole as participants report; a settled block must not pass through plain.
    const second = renderTooltipMarkdown(document, markdown, undefined, {
      codeTokenizer: tokenizer,
    })
    expect(second.querySelectorAll('pre > code > span')).toHaveLength(2)
  })

  it('keeps highlighted TypeScript code readable without forcing a tiny layout', () => {
    const element = renderTooltipMarkdown(
      document,
      '```typescript\nconst veryLongValueName: Record<string, number>\n```',
    )
    const pre = element.querySelector('pre') as HTMLElement | null
    const code = element.querySelector('code') as HTMLElement | null

    expect(pre?.style.maxWidth).toBe('100%')
    expect(code?.style.getPropertyValue('white-space')).toBe('pre-wrap')
    expect(code?.style.overflowWrap).toBe('break-word')
    expect(code?.textContent).toContain('veryLongValueName')
    expect(
      element.style.getPropertyValue('--editor-typescript-lsp-hover-code-block-background'),
    ).toBe('')
  })

  it('does not render code backgrounds by default', () => {
    const element = renderTooltipMarkdown(document, '`value`\n\n```ts\nconst value = 1\n```')

    expect(
      element.style.getPropertyValue('--editor-typescript-lsp-hover-inline-code-background'),
    ).toBe('')
    expect(
      element.style.getPropertyValue('--editor-typescript-lsp-hover-code-block-background'),
    ).toBe('')
  })

  it('can render code backgrounds when requested', () => {
    const element = renderTooltipMarkdown(
      document,
      '`value`\n\n```ts\nconst value = 1\n```',
      null,
      { codeBackground: true },
    )

    expect(
      element.style.getPropertyValue('--editor-typescript-lsp-hover-inline-code-background'),
    ).toContain('color-mix')
    expect(
      element.style.getPropertyValue('--editor-typescript-lsp-hover-code-block-background'),
    ).toContain('color-mix')
  })

  it('applies an editor theme to Markdown tooltip content', () => {
    const element = renderTooltipMarkdown(document, "```ts\nconst value = 'x'\n```", {
      foregroundColor: '#24292f',
      syntax: {
        keyword: '#cf222e',
        string: '#0a3069',
      },
    })

    expect(element.style.getPropertyValue('--editor-foreground')).toBe('#24292f')
    expect(element.style.getPropertyValue('--editor-syntax-keyword')).toBe('#cf222e')
    expect(element.style.getPropertyValue('--editor-syntax-string')).toBe('#0a3069')
  })

  it('renders paragraphs, emphasis, strong text, and inline code', () => {
    const element = renderTooltipMarkdown(
      document,
      'Use `value` with *care* and **strict** checks.',
    )

    expect(element.querySelector('p')?.textContent).toBe('Use value with care and strict checks.')
    expect(element.querySelector('code')?.textContent).toBe('value')
    expect(element.querySelector('em')?.textContent).toBe('care')
    expect(element.querySelector('strong')?.textContent).toBe('strict')
  })

  it('renders GFM lists and tables', () => {
    const element = renderTooltipMarkdown(
      document,
      [
        '- [x] done',
        '- [ ] todo',
        '',
        '| Name | Type |',
        '| --- | --- |',
        '| value | string |',
      ].join('\n'),
    )

    expect(element.querySelectorAll('li')).toHaveLength(2)
    expect(element.querySelectorAll("input[type='checkbox']")).toHaveLength(2)
    expect(element.querySelector('table')?.textContent).toContain('valuestring')
  })

  it('renders safe links with noreferrer and a new tab target', () => {
    const element = renderTooltipMarkdown(document, '[docs](https://example.com/path)')
    const link = element.querySelector('a')

    expect(link?.href).toBe('https://example.com/path')
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toBe('noreferrer')
  })

  it('does not create unsafe links or inject raw HTML', () => {
    const element = renderTooltipMarkdown(
      document,
      '[bad](javascript:alert(1)) <img src=x onerror="alert(1)">',
    )

    expect(element.querySelector('a')).toBeNull()
    expect(element.querySelector('img')).toBeNull()
    expect(element.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('normalizes Markdown with remark-stringify', () => {
    expect(normalizeTooltipMarkdown('**value**').trim()).toBe('**value**')
  })
})

function renderTooltipMarkdown(
  document: Document,
  markdown: string,
  theme?: EditorTheme | null,
  options: TooltipMarkdownRenderOptions = {},
): HTMLElement {
  return renderLanguageServerTooltipMarkdown(document, markdown, theme, {
    ...options,
    classNamespace: 'typescript-lsp',
  })
}
