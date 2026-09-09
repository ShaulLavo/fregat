import { testScopedStorage } from './factories/scoped-storage'
import { testWorkspaceAddress } from './factories/workspace-address'
import type { WorkspaceAddress } from '@workspace/contracts'
import { waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { expect, onTestFinished } from 'vitest'

import { useAddressProjection } from '@/features/address/hooks/use-projection'
import { PROJECTION_DEBOUNCE_MS } from '@/features/address/state/projection'
import { useAddressRestore } from '@/features/address/hooks/use-restore'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { createApplicationRuntime } from '@/state/application-runtime'
import { addressedWorkspaceCache } from '@/features/address/utils/cache'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
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
  openEditorPathInWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import {
  writeRootFolderCache,
  writeWorkspaceIndexCache,
  writeWorkspaceSliceCache,
  writeUiModeCache,
  writeWorkbenchLayoutCache,
  writeChatModePanelsCache,
} from '@/features/workspace/state/cache'

import { renderApplication } from './render'

/**
 * Mounts the two address hooks over the real store stack.
 *
 * Neither hook had ever been mounted in a test, which is the gap every history and
 * tab-lifecycle bug lived in: `utils/` is pure and heavily covered, while the edges
 * that decide when to push, what to close, and who wins at boot were covered only by
 * argument. This harness exists so those can be asserted instead.
 */

export type AddressHarness = {
  readonly documents: EditorDocumentStoreApi
  readonly workspace: EditorWorkspaceStoreApi
}

/**
 * Seeds the caches the app really reads at boot, through the app's own writers rather
 * than raw `localStorage` — a hand-written key that drifts from `CACHE_VERSION` would
 * make the test pass by restoring nothing.
 */
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
  const panels = tabPaths.reduce(openEditorPathInWorkbenchPanels, createDefaultWorkbenchPanels())

  writeRootFolderCache(testScopedStorage, {
    ...directoryEntry(rootPath),
    workspaceAddress,
  })
  writeWorkspaceIndexCache(testScopedStorage, [rootPath, ...knownRoots])
  writeWorkspaceSliceCache(testScopedStorage, rootPath, {
    editorHistory: [],
    recentlyClosedEditorPaths: [],
    scrollPositionByPath: {},
    workbenchPanels: panels,
  })
  writeUiModeCache('workbench')
  writeWorkbenchLayoutCache(createDefaultWorkbenchLayout())
  writeChatModePanelsCache(createDefaultChatModePanels())

  return panels
}

/**
 * A full `PickedFsEntry`. The stat fields are not decoration: `rootFolderSchema`
 * rejects an entry without them and `readCacheEntry` falls back to `null`, which reads
 * downstream as "no folder open" — a seeding bug that looks exactly like the restore
 * bugs these tests are here to catch.
 */
function directoryEntry(rootPath: string) {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: rootPath.split('/').filter(Boolean).at(-1) ?? '',
    path: rootPath,
    size: 0,
    type: 'directory' as const,
    version: '',
  }
}

/** Puts `href` in the address bar before anything reads it, the way a cold load would. */
export function startAt(href: string) {
  history.replaceState(null, '', href)
}

function Harness({ expose }: { readonly expose: (harness: AddressHarness) => void }) {
  const workspace = useEditorWorkspaceStoreApi()
  const documents = useEditorDocumentStoreApi()

  useAddressRestore()
  useAddressProjection()

  // An effect, not a render-time call: this must observe the stores as the address
  // hooks left them, and child effects run before this one only because it is declared
  // last in the same component.
  useEffect(() => {
    expose({ documents, workspace })
  }, [documents, expose, workspace])

  return null
}

/**
 * Renders the address edges and resolves once the store handles are available.
 * `flushProjection` awaits the projection's own macrotask coalescing, so a test can
 * assert on the URL the app settled at rather than the one it passed through.
 */
export async function renderAddressHarness() {
  let harness: AddressHarness | null = null

  const application = createApplicationRuntime({
    workspaceCache: addressedWorkspaceCache(
      readWorkspaceCache(testScopedStorage),
      parseAddress(window.location.href),
    ),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: false,
    },
  })
  const rendered = renderApplication(
    <Harness
      expose={(next) => {
        harness = next
      }}
    />,
    application,
  )
  onTestFinished(() => application.dispose())

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

/**
 * Records the projection's history writes.
 *
 * `history.length` cannot carry this assertion: happy-dom does not truncate a forward
 * entry on `pushState` and `history.back()` does not emit `popstate`, so a test written
 * against the counter passes whether or not the bug is present. What is actually under
 * test is the projection's push-versus-replace DECISION, and that is observable.
 */
export function recordHistoryWrites() {
  const pushes: string[] = []
  const replaces: string[] = []
  const { pushState, replaceState } = history

  history.pushState = (data, unused, url) => {
    pushes.push(String(url))
    pushState.call(history, data, unused, url)
  }
  history.replaceState = (data, unused, url) => {
    replaces.push(String(url))
    replaceState.call(history, data, unused, url)
  }

  return {
    pushes,
    replaces,
    restore: () => {
      history.pushState = pushState
      history.replaceState = replaceState
    },
  }
}

/**
 * Captured at import, before any spy can wrap it. Moving the URL to simulate a back
 * press is the BROWSER's doing; counting it as a projection write would make
 * "returning costs no write" fail against correct code.
 */
const moveUrl = history.replaceState.bind(history)

/**
 * What a back press does, in the order the browser does it: the entry becomes current,
 * then `popstate` fires. happy-dom's `history.back()` does neither, so driving it
 * directly is the only way to exercise the inbound edge.
 */
export async function pressBack(href: string) {
  moveUrl(null, '', href)
  window.dispatchEvent(new PopStateEvent('popstate'))
  await flushProjection()
}

/**
 * Waits out the projection's trailing debounce, plus a margin for the applier's own
 * microtasks. Real timers rather than fake ones: the applier is async and Testing
 * Library's `waitFor` drives the same clock, so faking it here deadlocks more often
 * than it speeds anything up.
 */
export async function flushProjection() {
  await new Promise((resolve) => setTimeout(resolve, PROJECTION_DEBOUNCE_MS + 50))
}

export function editorTabPaths(workspace: EditorWorkspaceStoreApi) {
  return workspace.getState().workbenchPanels.editorTabs.map((tab) => tab.path)
}
