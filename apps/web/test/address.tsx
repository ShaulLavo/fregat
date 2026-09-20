import { allEditorTabs } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { testTabContents } from './factories/document-targets'
import { testScopedStorage } from './factories/scoped-storage'
import { testWorkspaceAddress } from './factories/workspace-address'
import type { WorkspaceAddress } from '@workspace/contracts'
import { render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { onTestFinished } from 'vitest'
import { expect } from './fixtures'
import { NavigationProvider } from '@/providers/navigation-provider'

import type { Navigation } from '@/state/navigation'
import { createTestNavigation } from './factories/navigation'
import { parseAddressIntent } from '@/features/address/utils/intent'
import { addressEnvironments } from '@/features/address/utils/environments'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { getClient } from '@/lib/client'
import {
  clientForQueryClient,
  registerEnvironmentQueryClient,
} from '@/lib/environments/state/query-clients'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { createApplicationRuntime } from '@/state/application-runtime'
import { addressedWorkspaceCache } from '@/features/address/utils/cache'
import {
  readWorkspaceCache,
  writeRootFolderCache,
  writeWorkspaceIndexCache,
  writeWorkspaceSliceCache,
  writeUiModeCache,
  writeWorkbenchLayoutCache,
  writeChatModePanelsCache,
} from '@/features/workspace/state/cache'
import {
  useEditorWorkspaceStoreApi,
  type EditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import {
  useEditorDocumentStoreApi,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import {
  createDefaultWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
} from '@/features/workbench/utils/panels'

import { renderApplication } from './render'

type AddressHarness = {
  readonly documents: EditorDocumentStoreApi
  readonly workspace: EditorWorkspaceStoreApi
}

export function seedWorkspaceCache({
  rootPath,
  tabPaths = [],
  knownRoots = [],
  workspaceAddress = testWorkspaceAddress(rootPath),
}: {
  readonly rootPath: string
  readonly tabPaths?: readonly string[]
  readonly knownRoots?: readonly string[]
  readonly workspaceAddress?: WorkspaceAddress
}) {
  const panels = testTabContents(tabPaths, rootPath).reduce(
    openEditorContentInWorkbenchPanels,
    createDefaultWorkbenchPanels(),
  )

  writeRootFolderCache(testScopedStorage, {
    ...directoryEntry(rootPath),
    workspaceAddress,
  })
  writeWorkspaceIndexCache(testScopedStorage, [rootPath, ...knownRoots])
  writeWorkspaceSliceCache(testScopedStorage, rootPath, {
    editorHistory: [],
    recentlyClosedTabs: [],
    reopenScrollPositions: [],
    viewScrollPositions: [],
    workbenchPanels: panels,
  })
  writeUiModeCache('workbench')
  writeWorkbenchLayoutCache(createDefaultWorkbenchLayout())
  writeChatModePanelsCache(createDefaultChatModePanels())

  return panels
}

function directoryEntry(rootPath: string) {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: rootPath.split('/').filter(Boolean).at(-1) ?? '',
    path: filesystemPath(rootPath),
    size: 0,
    type: 'directory' as const,
    version: '',
  }
}

export function startAt(href: string) {
  history.replaceState(null, '', href)
}

export function renderPendingNavigation(navigation: Navigation) {
  return render(<NavigationProvider navigation={navigation}>{null}</NavigationProvider>)
}

function Harness({ expose }: { readonly expose: (harness: AddressHarness) => void }) {
  const workspace = useEditorWorkspaceStoreApi()
  const documents = useEditorDocumentStoreApi()

  // An effect, not a render-time call: this must observe the stores as the address
  // hooks left them, and child effects run before this one only because it is declared
  // last in the same component.
  useEffect(() => {
    expose({ documents, workspace })
  }, [documents, expose, workspace])

  return null
}

export async function renderAddressHarness({
  initialEntries = [`${window.location.pathname}${window.location.search}${window.location.hash}`],
  initialIndex,
  navigation: suppliedNavigation,
}: {
  readonly initialEntries?: string[]
  readonly initialIndex?: number
  readonly navigation?: Navigation
} = {}) {
  let harness: AddressHarness | null = null

  const initialHref = initialEntries[initialIndex ?? initialEntries.length - 1] ?? '/'
  const initial =
    suppliedNavigation?.initial ??
    parseAddressIntent(initialHref, addressEnvironments(useEnvironmentsStore.getState().entries))
  const application = createApplicationRuntime({
    workspaceCache: addressedWorkspaceCache(readWorkspaceCache(testScopedStorage), initial.address),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: false,
    },
  })
  const navigation = suppliedNavigation ?? createTestNavigation({ initialEntries, initialIndex })
  const owner = application.getSnapshot()
  const previousClient = clientForQueryClient(owner.queryClient)
  registerEnvironmentQueryClient(owner.queryClient, owner.origin, getClient())
  const rendered = renderApplication(
    <Harness
      expose={(next) => {
        harness = next
      }}
    />,
    application,
    { navigation },
  )
  onTestFinished(() => {
    rendered.unmount()
    application.dispose()
    registerEnvironmentQueryClient(owner.queryClient, owner.origin, previousClient)
  })

  // `waitFor` retries until the assertion stops failing, so this IS the wait.
  await waitFor(() => {
    expect(harness).not.toBeNull()
  })

  return {
    ...rendered,
    application,
    get harness() {
      if (!harness) return expect.unreachable('address harness never mounted')

      return harness
    },
  }
}

export function recordHistoryWrites(navigation: Navigation) {
  const pushes: string[] = []
  const replaces: string[] = []
  const restore = navigation.router.history.subscribe(({ action, location }) => {
    if (action.type === 'PUSH') pushes.push(location.href)
    if (action.type === 'REPLACE') replaces.push(location.href)
  })
  return { pushes, replaces, restore }
}

export async function waitForNavigation(navigation: Navigation) {
  await waitFor(() => expect(navigation.getSnapshot().status).not.toBe('pending'))
  return navigation.getSnapshot()
}

export async function pressBack(navigation: Navigation) {
  navigation.back()
  return waitForNavigation(navigation)
}

export function editorTabContents(workspace: EditorWorkspaceStoreApi) {
  return allEditorTabs(workspace.getState().workbenchPanels.editorGroups).map((tab) => tab.content)
}
