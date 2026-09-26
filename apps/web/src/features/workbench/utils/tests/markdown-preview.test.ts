import { expect, test } from '../../../../../test/fixtures'

import {
  markdownPreviewImageSource,
  markdownPreviewTarget,
} from '@/features/workbench/utils/markdown-preview-paths'
import {
  lineForRenderedTop,
  renderedTopForLine,
  risingAnchors,
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

test('preserves malformed percent escapes as literal workspace paths', () => {
  expect(markdownPreviewTarget('bad%ZZ.md', 'repo/docs/guide.md', 'repo')).toEqual({
    kind: 'file',
    path: 'repo/docs/bad%ZZ.md',
  })
})

test.each(['../../etc/hosts', '../../repo-other/file', '%2e%2e/%2e%2e/etc/hosts'])(
  'rejects a workspace escape: %s',
  (href) => {
    expect(markdownPreviewTarget(href, 'repo/docs/a.md', 'repo')).toEqual({ kind: 'unavailable' })
  },
)

test('keeps absolute workspace paths absolute', () => {
  expect(markdownPreviewTarget('../README.md', '/repo/docs/a.md', '/repo')).toEqual({
    kind: 'file',
    path: '/repo/README.md',
  })
  expect(markdownPreviewTarget('/plans/a.md', '/repo/docs/a.md', '/repo')).toEqual({
    kind: 'file',
    path: '/repo/plans/a.md',
  })
  expect(markdownPreviewImageSource('a.png', '/repo/docs/a.md', '/repo', 'http://x')).toBe(
    'http://x/fs/blob?path=%2Frepo%2Fdocs%2Fa.png',
  )
})

test.each([
  ['../../../x.png', '/docs/a.md', '/'],
  ['../../etc/hosts', '/repo/docs/a.md', '/repo'],
  ['../other/a.md', '/repo/a.md', '/repo'],
])('rejects an absolute-root escape: %s', (href, documentPath, rootPath) => {
  expect(markdownPreviewTarget(href, documentPath, rootPath)).toEqual({ kind: 'unavailable' })
})

test('drops every anchor below the last kept line, not only the one before it', () => {
  // Footnote definitions at lines 5 and 6 render after the paragraph at line 30.
  const sorted = risingAnchors([
    { line: 1, top: 0 },
    { line: 30, top: 600 },
    { line: 5, top: 700 },
    { line: 6, top: 720 },
  ])
  expect(sorted.map((anchor) => anchor.line)).toEqual([1, 30])
})
