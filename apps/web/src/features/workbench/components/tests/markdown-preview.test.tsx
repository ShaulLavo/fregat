import { act, render, waitFor } from '@testing-library/react'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createEditorBufferSession } from '@singapore-editor/core/document'
import { Markdown } from '@workspace/markdown/components/markdown'

import { MarkdownPreviewCodeBlock } from '@/features/workbench/components/markdown-preview-code-block'
import { MarkdownPreviewImage } from '@/features/workbench/components/markdown-preview-image'
import { MarkdownPreviewLink } from '@/features/workbench/components/markdown-preview-link'
import { MarkdownPreviewContext } from '@/features/workbench/providers/markdown-preview-context'
import {
  sourceAnchors,
  renderedTopForLine,
} from '@/features/workbench/utils/markdown-scroll-positions'
import { expect, test } from '../../../../../test/fixtures'
import { createTestApplicationRuntime } from '../../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { renderWithProviders } from '../../../../../test/render'
import { MarkdownPreviewPane } from '@/features/workbench/components/markdown-preview-pane'
import { createMarkdownScrollSync } from '@/features/workbench/state/markdown-scroll-sync'
import { fileDocumentKey, filesystemPath, tabId } from '@/lib/documents/utils/identity'
import { fetchFile } from '@/lib/file-server'

test('resolves reference images without changing a link sharing their definition', () => {
  const { container } = render(
    <MarkdownPreviewContext
      value={{
        documentPath: 'repo/docs/a.md',
        rootPath: 'repo',
        origin: 'http://example.com',
        openFile: () => {},
      }}
    >
      <Markdown
        components={{ img: MarkdownPreviewImage }}
        text={'![diagram][asset]\n\n[download][asset]\n\n[asset]: ./diagram.png'}
      />
    </MarkdownPreviewContext>,
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

test('raw HTML workspace images resolve after sanitizing the rendered tree', async () => {
  const { container } = render(
    <MarkdownPreviewContext
      value={{
        documentPath: 'repo/README.md',
        rootPath: 'repo',
        origin: 'http://example.com',
        openFile: () => {},
      }}
    >
      <Markdown
        components={{ img: MarkdownPreviewImage }}
        text={'<p align="center"><img src="docs/logo.png" width="200"></p>'}
      />
    </MarkdownPreviewContext>,
  )
  await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'http://example.com/fs/blob?path=repo%2Fdocs%2Flogo.png',
  )
})

test('out-of-workspace links and images render without a reachable URL', () => {
  const { container } = render(
    <MarkdownPreviewContext
      value={{
        documentPath: 'repo/docs/a.md',
        rootPath: 'repo',
        origin: 'http://example.com',
        openFile: () => {},
      }}
    >
      <Markdown
        components={{ img: MarkdownPreviewImage, a: MarkdownPreviewLink }}
        text={'[secret](../../etc/hosts)\n\n![secret](../../Pictures/x.png)'}
      />
    </MarkdownPreviewContext>,
  )
  expect(container.querySelector('a[href]')).toBeNull()
  expect(container.querySelector('img[src]')).toBeNull()
})

test('a rendered pane follows its real source buffer across unmount, remount and Undo', async ({
  server,
  client,
}) => {
  const initial = '# Shared source\n'
  await writeFile(join(server.root, 'shared.md'), initial)
  await writeFile(join(server.root, 'other.md'), '# Other source\n')
  const signal = new AbortController().signal
  const application = createTestApplicationRuntime()
  const { editor, queryClient } = application.getSnapshot()
  const state = editor.documentStore.getState()
  const source = state.ensureEditorView(
    tabId('markdown-source'),
    await fetchFile(filesystemPath('shared.md'), signal, client),
  )
  const other = state.ensureLiveEditorDocument(
    await fetchFile(filesystemPath('other.md'), signal, client),
  )
  const session = createEditorBufferSession(source.buffer, source.view)
  const initialSnapshot = source.buffer.getTextSnapshot()
  const initialRevision = source.buffer.getRevision()
  const scroll = createMarkdownScrollSync()
  const pane = (
    <TestEditorStateProvider>
      <MarkdownPreviewPane
        buffer={source.buffer}
        documentPath='shared.md'
        rootPath=''
        sync={scroll}
      />
    </TestEditorStateProvider>
  )
  const view = renderWithProviders(pane, { application, queryClient })
  try {
    await view.findByRole('heading', { name: 'Shared source' })
    expect(source.buffer).not.toBe(other.buffer)
    await act(async () => createEditorBufferSession(other.buffer).applyText('wrong buffer edit'))
    expect(view.container.textContent).not.toContain('wrong buffer edit')
    expect(source.buffer.getRevision()).toBe(initialRevision)
    expect(source.buffer.isDirty()).toBe(false)

    act(() => session.applyText('\n## Actual source edit\n'))
    const editedSnapshot = source.buffer.getTextSnapshot()
    const editedRevision = source.buffer.getRevision()
    expect(editedSnapshot).not.toBe(initialSnapshot)
    expect(initialSnapshot.materializeFullText()).toBe(initial)
    expect(editedRevision).toBeGreaterThan(initialRevision)
    expect(source.buffer.isDirty()).toBe(true)
    await view.findByRole('heading', { name: 'Actual source edit' })

    view.rerender(<TestEditorStateProvider>{null}</TestEditorStateProvider>)
    expect(view.queryByRole('region', { name: 'Markdown preview' })).toBeNull()
    expect(
      editor.documentStore
        .getState()
        .getLiveEditorDocument(fileDocumentKey(filesystemPath('shared.md')))?.buffer,
    ).toBe(source.buffer)
    view.rerender(pane)
    await view.findByRole('heading', { name: 'Actual source edit' })
    expect(source.buffer.getTextSnapshot()).toBe(editedSnapshot)
    expect(source.buffer.getRevision()).toBe(editedRevision)

    act(() => source.buffer.undo())
    await waitFor(() =>
      expect(view.queryByRole('heading', { name: 'Actual source edit' })).toBeNull(),
    )
    expect(source.buffer.materializeFullText()).toBe(initial)
    expect(source.buffer.isDirty()).toBe(false)
    expect(source.buffer.getRevision()).toBeGreaterThan(editedRevision)
    expect(editor.documentStore.getState().getEditorView(tabId('markdown-source'))?.view).toBe(
      source.view,
    )
  } finally {
    view.unmount()
  }
})
