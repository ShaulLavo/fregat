import { createTextDiff } from '@singapore-editor/diff'
import { waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { DiffEditor } from '@/features/editor/components/diff-editor'
import { createEditorUiStore, EditorUiStateContext } from '@/features/editor/state/ui-state'
import { tabId } from '@/lib/documents/utils/identity'
import { stubEditorViewport } from '../../../../../test/env/editor-viewport'
import { stubHighlightApi } from '../../../../../test/env/highlight-api'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

test('switching diff tabs restores each tab’s pane proportions', async () => {
  stubEditorViewport()
  stubHighlightApi()
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  const uiStore = createEditorUiStore()
  const first = tabId('first-diff')
  const second = tabId('second-diff')
  uiStore.getState().tabPresentation.get(first).setDiffLayout({ 'diff-old': 40, 'diff-new': 60 })
  uiStore.getState().tabPresentation.get(second).setDiffLayout({ 'diff-old': 75, 'diff-new': 25 })
  const files = [first, second].map((id) =>
    createTextDiff({
      oldFile: { path: id, text: 'before\n' },
      newFile: { path: id, text: 'after\n' },
    }),
  )
  function body(index: 0 | 1) {
    return (
      <EditorUiStateContext value={uiStore}>
        <DiffEditor file={files[index]!} mode='split' tabId={index === 0 ? first : second} />
      </EditorUiStateContext>
    )
  }
  try {
    const rendered = renderWithProviders(body(0))
    const oldPane = () => document.getElementById('diff-old')?.style.flexGrow
    await waitFor(() => expect(oldPane()).toBe('40'))
    rendered.rerender(body(1))
    await waitFor(() => expect(oldPane()).toBe('75'))
    rendered.rerender(body(0))
    await waitFor(() => expect(oldPane()).toBe('40'))
  } finally {
    width.mockRestore()
  }
})
