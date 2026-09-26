import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

import { useActiveFileChip } from '@/features/chat/hooks/use-active-file-chip'
import { openEditorContentInWorkbenchPanels } from '@/features/workbench/utils/panels'
import { documentTab } from '@/lib/documents/utils/tabs'
import { fileDocument, fileResource, filesystemPath } from '@/lib/documents/utils/identity'
import { createTestApplicationRuntime } from '../../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../../test/factories/editor-state-provider'
import { settingsSnapshot } from '../../../../../test/factories/settings'
import { expect, test } from '../../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../../test/render'

test('dismissal expires after switching from A to B and back to A', async () => {
  const application = createTestApplicationRuntime()
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(
    settingsKeys.document(),
    settingsSnapshot({ values: { 'chat.activeFileContext': true } }),
  )
  const workspace = application.getSnapshot().editor.workspaceStore
  function select(path: string) {
    const state = workspace.getState()
    state.setWorkbenchPanels(
      openEditorContentInWorkbenchPanels(
        state.workbenchPanels,
        documentTab(fileDocument(fileResource(filesystemPath(path)))),
      ),
    )
  }
  select('/repo/a.ts')
  renderWithProviders(
    <TestEditorStateProvider>
      <Chip />
    </TestEditorStateProvider>,
    { application, queryClient },
  )
  expect(screen.getByRole('status')).toHaveTextContent('a.ts')
  await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(screen.getByRole('status')).toBeEmptyDOMElement()
  act(() => select('/repo/b.ts'))
  expect(screen.getByRole('status')).toHaveTextContent('b.ts')
  act(() => select('/repo/a.ts'))
  expect(screen.getByRole('status')).toHaveTextContent('a.ts')
})

function Chip() {
  const chip = useActiveFileChip('/repo')
  return (
    <>
      <output role='status'>{chip.path}</output>
      <button onClick={chip.remove}>Remove</button>
    </>
  )
}
