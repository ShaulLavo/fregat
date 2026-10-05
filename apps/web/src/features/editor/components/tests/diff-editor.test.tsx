import { projectionControl } from '../../../../../test/factories/diff-attachment'
import { createTextDiff } from '@singapore-editor/diff'
import { Editor } from '@singapore-editor/core/editor'
import { vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { tabId } from '@/lib/documents/utils/identity'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'

test('switching split comparisons reuses both editor instances', async () => {
  stubHighlightApi()
  stubEditorViewport()
  const files = ['alpha', 'bravo'].map((name) =>
    createTextDiff({
      oldFile: { path: `${name}.txt`, text: `${name} before` },
      newFile: { path: `${name}.txt`, text: `${name} after` },
    }),
  )
  const { rerender, container } = renderWithProviders(
    <DiffEditor attachment={projectionControl(files[0]!)} mode='split' tabId={tabId('alpha')} />,
  )
  await waitFor(() => expect(container.textContent).toContain('alpha after'))
  const editors = [...container.querySelectorAll('.editor-diff-pane .editor-virtualized')]
  expect(editors).toHaveLength(2)
  rerender(
    <DiffEditor attachment={projectionControl(files[1]!)} mode='split' tabId={tabId('bravo')} />,
  )
  await waitFor(() => expect(container.textContent).toContain('bravo after'))
  const switched = container.querySelectorAll('.editor-diff-pane .editor-virtualized')
  expect(switched).toHaveLength(2)
  for (const [index, editor] of editors.entries()) expect(switched[index]).toBe(editor)
})

test('equal projected text opens a different comparison subject', async () => {
  stubHighlightApi()
  stubEditorViewport()
  const open = vi.spyOn(Editor.prototype, 'openDocument')
  const file = createTextDiff({
    oldFile: { path: 'source.txt', text: 'before' },
    newFile: { path: 'source.txt', text: 'after' },
  })
  try {
    const { rerender, container } = renderWithProviders(
      <DiffEditor
        attachment={projectionControl(file, 'first-subject')}
        mode='stacked'
        tabId={tabId('first-subject')}
      />,
    )
    await waitFor(() => expect(container.textContent).toContain('after'))
    const first = open.mock.calls.at(-1)?.[0].documentId
    expect(first).toMatch(/^projection:/)
    rerender(
      <DiffEditor
        attachment={projectionControl(file, 'second-subject')}
        mode='stacked'
        tabId={tabId('second-subject')}
      />,
    )
    await waitFor(() => expect(open.mock.calls.at(-1)?.[0].documentId).not.toBe(first))
  } finally {
    open.mockRestore()
  }
})
