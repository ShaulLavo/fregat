import { testWorkspaceAddress } from '../../../test/factories/workspace-address'
import { testTabContent } from '../../../test/factories/document-targets'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { act, screen } from '@testing-library/react'
import { afterEach } from 'vitest'

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
  // The document title moved to the editor breadcrumbs; the titlebar names only the workspace.
  expect(screen.queryByText('app.tsx')).toBeNull()
})

afterEach(() => {
  delete (navigator as Navigator & { windowControlsOverlay?: unknown }).windowControlsOverlay
  delete window.platformBridge
  document.documentElement.removeAttribute('data-native-fullscreen')
})

test('WCO geometry reserves either control edge and responds to geometry changes without a bridge', () => {
  const overlay = new EventTarget()
  let rect = { x: 80, y: 0, width: 900, height: 32 }
  let visible = true
  Object.defineProperty(navigator, 'windowControlsOverlay', {
    configurable: true,
    value: Object.assign(overlay, {
      get visible() {
        return visible
      },
      getTitlebarAreaRect: () => rect,
    }),
  })
  // Define a live getter after Object.assign so visibility changes remain observable.
  Object.defineProperty(overlay, 'visible', { get: () => visible })
  const store = createTitlebarStore()
  renderWithProviders(<TitlebarTestProvider store={store} />, {
    command: { runtime: { workspace: store } },
  })
  const toolbar = screen.getByRole('banner', { name: 'Window toolbar' })
  expect(window.platformBridge).toBeUndefined()
  expect(toolbar).toHaveStyle({ marginLeft: '80px', width: '900px', height: '32px' })
  act(() => {
    rect = { x: 0, y: 0, width: 840, height: 40 }
    overlay.dispatchEvent(new Event('geometrychange'))
  })
  expect(toolbar).toHaveStyle({ marginLeft: '0px', width: '840px', height: '40px' })
  act(() => {
    visible = false
    overlay.dispatchEvent(new Event('geometrychange'))
  })
  expect(toolbar.style.width).toBe('')
  expect(toolbar.style.marginLeft).toBe('')
  expect(toolbar).toHaveClass('window-drag')
  expect(screen.getByRole('button', { name: 'Switch project' })).toHaveClass('window-no-drag')
  act(() => {
    rect = { x: 80, y: 0, width: 900, height: 32 }
    visible = true
    overlay.dispatchEvent(new Event('geometrychange'))
  })
  expect(toolbar).toHaveStyle({ marginLeft: '80px', width: '900px', height: '32px' })
})

test('native macOS traffic-light inset follows full-screen entry, reload, and exit', () => {
  window.platformBridge = {
    platform: 'darwin',
    titlebar: 'overlay',
    backdrop: 'transparent',
    colorScheme: null,
  }
  const store = createTitlebarStore()
  const view = renderWithProviders(<TitlebarTestProvider store={store} />, {
    command: { runtime: { workspace: store } },
  })
  const projectArea = () => screen.getByRole('banner', { name: 'Window toolbar' }).firstElementChild
  expect(projectArea()).toHaveClass('pl-[4.75rem]')
  act(() => {
    document.documentElement.setAttribute('data-native-fullscreen', '')
    window.dispatchEvent(new Event('platform-native-window-state'))
  })
  expect(projectArea()).not.toHaveClass('pl-[4.75rem]')
  view.rerender(<TitlebarTestProvider store={store} />)
  expect(projectArea()).not.toHaveClass('pl-[4.75rem]')
  act(() => {
    document.documentElement.removeAttribute('data-native-fullscreen')
    window.dispatchEvent(new Event('platform-native-window-state'))
  })
  expect(projectArea()).toHaveClass('pl-[4.75rem]')
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
      workspaceAddress: testWorkspaceAddress('/repo'),
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
        viewScrollPositions: [],
        workbenchPanels: panels,
      },
    },
  })
}
