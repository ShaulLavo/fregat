import { act, waitFor } from '@testing-library/react'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { useSearchBufferRuntime } from '@/features/search/hooks/use-buffer-runtime'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

test('completes a query restored before the search debounce settles', async ({ server, client }) => {
  void client
  await writeFile(join(server.root, 'needle.ts'), 'export const needle = 1\n')
  const application = createTestApplicationRuntime()
  const store = application.getSnapshot().editor.searchBufferStore
  store.getState().prepareBuffer('')
  store.getState().setQuery('', 'needle')

  const view = renderWithProviders(
    <TestEditorStateProvider>
      <SearchRuntime />
    </TestEditorStateProvider>,
    { application },
  )
  try {
    await waitFor(() => {
      expect(store.getState().active?.status).toBe('ready')
      expect(store.getState().active?.matches).toHaveLength(1)
    })
    act(() => store.getState().setQuery('', 'needl'))
    act(() => store.getState().setQuery('', 'needle'))
    await waitFor(() => {
      expect(store.getState().active?.status).toBe('ready')
      expect(store.getState().active?.resultsQuery).toBe('needle')
      expect(store.getState().active?.matches).toHaveLength(1)
    })
  } finally {
    view.unmount()
  }
})

function SearchRuntime() {
  useSearchBufferRuntime('')
  return null
}
