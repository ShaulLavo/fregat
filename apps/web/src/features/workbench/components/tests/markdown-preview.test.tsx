import { render } from '@testing-library/react'
import { Markdown } from '@workspace/markdown/components/markdown'

import { MarkdownPreviewCodeBlock } from '@/features/workbench/components/markdown-preview-code-block'
import { remarkPreviewImages } from '@/features/workbench/utils/markdown-preview-images'
import {
  sourceAnchors,
  renderedTopForLine,
} from '@/features/workbench/utils/markdown-scroll-positions'
import { expect, test } from '../../../../../test/fixtures'

test('resolves reference images without changing a link sharing their definition', () => {
  const { container } = render(
    <Markdown
      remarkPlugins={[
        [
          remarkPreviewImages,
          { documentPath: 'repo/docs/a.md', rootPath: 'repo', origin: 'http://example.com' },
        ],
      ]}
      text={'![diagram][asset]\n\n[download][asset]\n\n[asset]: ./diagram.png'}
    />,
  )
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'http://example.com/fs/blob?path=repo%2Fdocs%2Fdiagram.png',
  )
  expect(container.querySelector('a')?.getAttribute('href')).toBe('./diagram.png')
})

test('renders both source endpoints of a standalone fence for scroll sync', () => {
  const { container } = render(
    <Markdown codeBlock={MarkdownPreviewCodeBlock} text={'```ts\none\ntwo\nthree\n```'} />,
  )
  const fence = container.querySelector<HTMLElement>('[data-source-line]')
  expect(fence?.dataset.sourceLine).toBe('1')
  expect(fence?.dataset.sourceEndLine).toBe('5')
  if (!fence) return
  fence.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
  const anchors = sourceAnchors(container)
  expect(anchors).toEqual([
    { line: 1, top: 0 },
    { line: 5, top: 100 },
  ])
  expect(renderedTopForLine(anchors, 3)).toBe(50)
})
