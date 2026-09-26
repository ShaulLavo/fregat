import { createTextDiff } from '@singapore-editor/diff'
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
    <DiffEditor file={files[0]!} mode='split' tabId={tabId('alpha')} />,
  )
  await waitFor(() => expect(container.textContent).toContain('alpha after'))
  const editors = [...container.querySelectorAll('.editor-diff-pane .editor-virtualized')]
  expect(editors).toHaveLength(2)
  rerender(<DiffEditor file={files[1]!} mode='split' tabId={tabId('bravo')} />)
  await waitFor(() => expect(container.textContent).toContain('bravo after'))
  const switched = container.querySelectorAll('.editor-diff-pane .editor-virtualized')
  expect(switched).toHaveLength(2)
  for (const [index, editor] of editors.entries()) expect(switched[index]).toBe(editor)
})
