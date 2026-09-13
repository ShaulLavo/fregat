import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import type { MarkdownCodeBlockProps } from '../../providers/render-context'
import { setMarkdownExtensionLoaders } from '../../state/extensions'
import { Markdown } from '../markdown'

afterEach(() => {
  setMarkdownExtensionLoaders(null)
})

function CodeBlock({ code, incomplete, language, meta }: MarkdownCodeBlockProps) {
  return (
    <div data-code-block={language} data-incomplete={incomplete} data-meta={meta ?? ''}>
      {code}
    </div>
  )
}

describe('Markdown', () => {
  test('renders GFM through the default elements', () => {
    const { container } = render(
      <Markdown text={'# Title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n~~gone~~ and `code`'} />,
    )

    expect(container.querySelector('h1')?.textContent).toBe('Title')
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('del')?.textContent).toBe('gone')
    expect(container.querySelector('code')?.className).toContain('font-mono')
  })

  test('hands every fence to the code block renderer with its streaming state', () => {
    const { container, rerender } = render(
      <Markdown codeBlock={CodeBlock} streaming text={'```ts title="a.ts"\nconst open ='} />,
    )
    const streaming = container.querySelector('[data-code-block="ts"]')

    expect(streaming?.textContent).toBe('const open =')
    expect(streaming?.getAttribute('data-incomplete')).toBe('true')
    expect(streaming?.getAttribute('data-meta')).toBe('title="a.ts"')

    rerender(<Markdown codeBlock={CodeBlock} text={'```ts title="a.ts"\nconst open = 1\n```\n'} />)

    expect(container.querySelector('[data-code-block="ts"]')?.getAttribute('data-incomplete')).toBe(
      'false',
    )
  })

  test('component overrides receive the pipeline class names', () => {
    const { container } = render(
      <Markdown
        components={{
          a: ({ children, className, href }) => (
            <a className={`${className} mine`} data-mine='yes' href={href}>
              {children}
            </a>
          ),
        }}
        text='See [docs](https://example.com).'
      />,
    )
    const link = container.querySelector('a')

    expect(link?.getAttribute('data-mine')).toBe('yes')
    expect(link?.className).toContain('text-primary')
    expect(link?.className).toContain('mine')
    expect(link?.getAttribute('href')).toBe('https://example.com')
  })

  test('settled DOM is reused as the stream appends', () => {
    const { container, rerender } = render(
      <Markdown streaming text={'# Title\n\n```ts\nconst a = 1\n```\n\nfirst'} />,
    )
    const heading = container.querySelector('h1')

    rerender(<Markdown streaming text={'# Title\n\n```ts\nconst a = 1\n```\n\nfirst **second'} />)

    expect(container.querySelector('h1')).toBe(heading)
    expect(container.querySelector('strong')?.textContent).toBe('second')
  })

  test('shows a caret while streaming, except inside an open fence', () => {
    const { container, rerender } = render(<Markdown caret streaming text='hello' />)
    const root = container.firstElementChild

    expect(root?.className).toContain('after:content-')

    rerender(<Markdown caret streaming text={'hello\n\n```ts\nconst a ='} />)
    expect(root?.className).not.toContain('after:content-')

    rerender(<Markdown caret text='hello' />)
    expect(root?.className).not.toContain('after:content-')
  })

  test('raw HTML appears once its stage has loaded', async () => {
    let resolve: (() => void) | null = null
    setMarkdownExtensionLoaders({
      raw: () =>
        new Promise((done) => {
          resolve = () => done(import('rehype-raw'))
        }),
    })
    const { container } = render(<Markdown text={'before <kbd>Ctrl</kbd> after'} />)

    expect(container.querySelector('kbd')).toBeNull()
    expect(container.textContent).toContain('before')

    await act(async () => {
      resolve?.()
    })
    await waitFor(() => expect(container.querySelector('kbd')?.textContent).toBe('Ctrl'))
  })

  test('math renders as MathML once KaTeX has loaded', async () => {
    const { container } = render(<Markdown codeBlock={CodeBlock} text={'$$\nx^2\n$$'} />)

    expect(container.querySelector('[data-code-block="math"]')).not.toBeNull()
    await waitFor(() => expect(container.querySelector('math')).not.toBeNull(), {
      timeout: 10_000,
    })
    expect(container.querySelector('[data-code-block="math"]')).toBeNull()
  })
})
