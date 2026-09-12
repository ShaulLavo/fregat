import { testTabContent } from '../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { screen } from '@testing-library/react'

import { AppTitlebar } from '@/components/app-titlebar'
import { TestEditorStateProvider as EditorStateProvider } from '../../../test/factories/editor-state-provider'
import {
  createEditorWorkspaceStore,
  EditorWorkspaceStateContext,
} from '@/features/editor/state/workspace-state'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import {
  createDefaultWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { NATIVE_WINDOW_DRAG_CLASS } from '@/lib/platform/window-drag'
import { expect, test } from '../../../test/fixtures'
import { renderWithProviders } from '../../../test/render'

test('renders app-owned window chrome as the only native drag region', () => {
  const store = createTitlebarStore()

  renderWithProviders(<TitlebarTestProvider store={store} />, {
    command: { runtime: { workspace: store } },
  })

  const toolbar = screen.getByRole('banner', { name: 'Window toolbar' })
  expect(toolbar).toHaveClass(NATIVE_WINDOW_DRAG_CLASS)
  expect(toolbar).toHaveStyle({ gridTemplateColumns: '24% minmax(0, 1fr) auto' })
  expect(screen.getByText('repo')).toBeVisible()
  expect(screen.getByText('app.tsx')).toBeVisible()
})

function TitlebarTestProvider({
  store,
}: {
  readonly store: ReturnType<typeof createTitlebarStore>
}) {
  // Real editor stack, with only the workspace store swapped for the fixture: the
  // titlebar's project menu opens roots, so it needs the document and ui stores too.
  return (
    <EditorStateProvider>
      <EditorWorkspaceStateContext.Provider value={store}>
        <AppTitlebar />
      </EditorWorkspaceStateContext.Provider>
    </EditorStateProvider>
  )
}

function createTitlebarStore() {
  const panels = openEditorContentInWorkbenchPanels(
    createDefaultWorkbenchPanels(),
    testTabContent('/repo/src/app.tsx'),
  )

  return createEditorWorkspaceStore({
    chatModePanels: createDefaultChatModePanels(),
    rootFolder: {
      birthtimeMs: 0,
      mtimeMs: 0,
      name: 'repo',
      path: filesystemPath('/repo'),
      size: 0,
      type: 'directory',
      version: '',
    },
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: ['/repo'],
    workspaces: {
      '/repo': {
        editorHistory: [],
        recentlyClosedTabs: [],
        reopenScrollPositions: [],
        workbenchPanels: panels,
      },
    },
  })
}
