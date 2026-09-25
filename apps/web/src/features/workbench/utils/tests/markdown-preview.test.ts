import { expect, test } from '../../../../../test/fixtures'

import {
  markdownPreviewImageSource,
  markdownPreviewTarget,
} from '@/features/workbench/utils/markdown-preview-paths'
import {
  lineForRenderedTop,
  renderedTopForLine,
  type SourceAnchor,
} from '@/features/workbench/utils/markdown-scroll-positions'

// A heading at line 1, a 100-line fence from line 3, a paragraph at line 105.
const anchors: SourceAnchor[] = [
  { line: 1, top: 0 },
  { line: 3, top: 40 },
  { line: 105, top: 2040 },
]

test('interpolates through a long fence in both directions', () => {
  expect(renderedTopForLine(anchors, 54)).toBe(1040)
  expect(lineForRenderedTop(anchors, 1040)).toBe(54)
  expect(renderedTopForLine(anchors, 200)).toBe(2040)
  expect(lineForRenderedTop(anchors, 0)).toBe(1)
})

test('resolves links from the file folder, the workspace root, or outside', () => {
  expect(markdownPreviewTarget('../README.md#top', 'repo/docs/guide.md', 'repo')).toEqual({
    kind: 'file',
    path: 'repo/README.md',
  })
  expect(markdownPreviewTarget('/plans/a.md', 'repo/docs/guide.md', 'repo')).toEqual({
    kind: 'file',
    path: 'repo/plans/a.md',
  })
  expect(markdownPreviewTarget('https://example.com', 'repo/a.md', 'repo').kind).toBe('external')
  expect(markdownPreviewTarget('#usage', 'repo/a.md', 'repo').kind).toBe('anchor')
  expect(markdownPreviewImageSource('img/a%20b.png', 'repo/docs/a.md', 'repo', 'http://x/')).toBe(
    'http://x/fs/blob?path=repo%2Fdocs%2Fimg%2Fa+b.png',
  )
})
