import { addressHrefFromBrowser, browserAddressHref } from '@/features/address/utils/browser-url'
import { addressRootClaimed, subscribeAddressRoot } from '@/features/address/state/root-claim'
import { scopedSessionKey } from '@workspace/contracts'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { addressEnvironments } from '@/features/address/utils/environments'
import { useEffect, useState } from 'react'

import { writeAddressCache } from '@/features/address/state/storage'
import {
  createAddressProjection,
  PROJECTION_DEBOUNCE_MS,
} from '@/features/address/state/projection'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { addressFromSnapshot, emptyAddressSnapshot } from '@/features/address/utils/snapshot'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import { diffScopeParam } from '@/features/address/utils/diff-scope'
import { sessionTokenFor } from '@/features/address/utils/session-token'
import { useSearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { searchParamsFor } from '@/features/address/utils/search-params'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { readLogsFilters, subscribeLogsFilters } from '@/features/logs/state/filter-store'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { logsParamsFor } from '@/features/address/utils/logs-params'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import { createDefaultWorkbenchPanels } from '@/features/workbench/utils/panels'
import {
  readSettingsCategory,
  subscribe as subscribeSettingsCategory,
} from '@/features/settings/state/category-store'
import { settingsCategorySlug } from '@/features/address/utils/settings-category'
import { useEditorUiStoreApi } from '@/features/editor/state/ui-state'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import type { EditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'

/**
 * Mounted once, beside the cache persistence it renders alongside.
 *
 * The store is the source of truth and the URL is a rendering of it, so this is an
 * outbound edge — with exactly one inbound fact, `adopt`, for the case the browser
 * moves the URL without asking: a back or forward press. Everything else here is
 * store → URL.
 */
export function useAddressProjection() {
  const storeApi = useEditorWorkspaceStoreApi()
  const uiStoreApi = useEditorUiStoreApi()
  const searchStoreApi = useSearchBufferStoreApi()
  // Captured once, before the first write, and carried into every address after it.
  // Four dev params are read by code outside React's lifecycle — two of them LATE,
  // `editorPerfLayout` during every editor render and `decode` on the first editor's
  // idle callback — so a projection that dropped them would change behaviour
  // mid-session with no error and no log.
  const [passthrough] = useState(
    () => parseAddress(addressHrefFromBrowser(window.location.href)).passthrough,
  )

  useEffect(() => {
    const projection = createAddressProjection({
      isSuspended: addressRootClaimed,
      environments: () => addressEnvironments(useEnvironmentsStore.getState().entries),
      // A timer, not `requestAnimationFrame`: rAF does not fire in a background or
      // not-yet-interacted tab, which left the address stuck at `/` until the user
      // clicked something.
      schedule: (write) => {
        const timer = setTimeout(write, PROJECTION_DEBOUNCE_MS)

        return () => clearTimeout(timer)
      },
      // `history` directly, not a router: a projection is a URL rewrite, not a
      // navigation. There is no route to match and no transition to run, so anything
      // more than `pushState`/`replaceState` would only add a re-render that could turn
      // this write back into an inbound apply.
      writer: {
        push: (href) => {
          history.pushState(null, '', browserAddressHref(href))
          writeAddressCache(href)
        },
        // The other half of the dual serialization. Writing both from one place is
        // what guarantees the URL and the restore payload cannot disagree.
        replace: (href) => {
          history.replaceState(null, '', browserAddressHref(href))
          writeAddressCache(href)
        },
      },
    })

    const project = () => {
      if (addressRootClaimed()) return
      const root = storeApi.getState().rootFolder
      if (root && !root.workspaceAddress) return
      const catalog = addressEnvironments(useEnvironmentsStore.getState().entries)
      if (
        parseAddress(addressHrefFromBrowser(window.location.href), catalog).rejectedEnvironment !==
        null
      )
        return
      projection.project(
        addressFromSnapshot(snapshotFromStore(storeApi, uiStoreApi, searchStoreApi, passthrough)),
      )
    }

    // The projection's own inbound edge, and the only one it has.
    //
    // Registration order against the applier's `popstate` listener does not matter:
    // both run synchronously while the event dispatches, and the store changes the
    // applier makes only schedule a flush onto a later macrotask. By the time `flush`
    // compares identities, this has already run.
    const adopt = () => {
      projection.adopt(addressHrefFromBrowser(window.location.href))
    }

    // A debounced write has a quiet period to survive, and closing the tab does not
    // wait for it. `pagehide` rather than `beforeunload`: it is the one that fires on
    // mobile and on back/forward-cache eviction.
    const flushNow = () => {
      projection.flushNow()
    }

    project()
    window.addEventListener('pagehide', flushNow)
    window.addEventListener('popstate', adopt)
    const unsubscribeRootClaim = subscribeAddressRoot(project)
    const unsubscribeEnvironments = useEnvironmentsStore.subscribe(project)
    const unsubscribeSelection = useSessionSelectionStore.subscribe(project)
    const unsubscribeRail = useSessionRailStore.subscribe(project)
    const unsubscribeDiffScope = useSessionDiffScopeStore.subscribe(project)
    const unsubscribeWorkspace = storeApi.subscribe(project)
    const unsubscribeUi = uiStoreApi.subscribe(project)
    const unsubscribeSearch = searchStoreApi.subscribe(project)
    const unsubscribeLogs = subscribeLogsFilters(project)
    // `snapshotFromStore` reads the settings category, so the projection has to hear
    // about it: clearing a pinned category changes nothing else, and without this the
    // URL kept `?settings=` until an unrelated store moved.
    const unsubscribeSettings = subscribeSettingsCategory(project)

    return () => {
      projection.cancel()
      window.removeEventListener('pagehide', flushNow)
      window.removeEventListener('popstate', adopt)
      unsubscribeRootClaim()
      unsubscribeEnvironments()
      unsubscribeDiffScope()
      unsubscribeRail()
      unsubscribeSelection()
      unsubscribeWorkspace()
      unsubscribeUi()
      unsubscribeSearch()
      unsubscribeLogs()
      unsubscribeSettings()
    }
  }, [passthrough, searchStoreApi, storeApi, uiStoreApi])
}

function snapshotFromStore(
  storeApi: EditorWorkspaceStoreApi,
  uiStoreApi: EditorUiStoreApi,
  searchStoreApi: SearchBufferStoreApi,
  passthrough: Record<string, string>,
) {
  const state = storeApi.getState()
  const rootPath = state.rootFolder?.path ?? null

  const environments = useEnvironmentsStore.getState()
  const entry = environments.entries[environments.activeOrigin]
  const environmentId = entry?.kind === 'primary' ? null : (entry?.environmentId ?? null)
  const panels = state.workbenchPanels
  const defaults = createDefaultWorkbenchPanels()

  return {
    ...emptyAddressSnapshot(),
    environmentId,
    activeDocumentPath: activeEditorTabForWorkbenchPanels(panels)?.path ?? null,
    focus: focusFor(uiStoreApi, activeEditorTabForWorkbenchPanels(panels)?.path ?? null),
    bottomTab: orAbsent(panels.activeBottomTab, defaults.activeBottomTab),
    editorTabPaths: panels.editorTabs.map((tab) => tab.path),
    workspaceAddress: state.rootFolder?.workspaceAddress ?? null,
    passthrough,
    mode: state.uiMode === 'chat' ? ('chat' as const) : ('workbench' as const),
    rootPath,
    railView: useSessionRailStore.getState().view === 'archived' ? ('archived' as const) : null,
    logs: logsParamsFor(readLogsFilters(), defaultLogsFilterState()),
    search: searchParamsFor(searchStoreApi.getState().active),
    sessionToken: sessionTokenFor(useSessionSelectionStore.getState().selection),
    sessionDiffScope: sessionDiffScopeParam(),
    settingsCategory: settingsCategoryOrNull(),
    sidebarTab: orAbsent(panels.activeSidebarTab, defaults.activeSidebarTab),
    toolTab: orAbsent(
      state.chatModePanels?.activeToolTab ?? null,
      createDefaultChatModePanels().activeToolTab,
    ),
  }
}

/**
 * The gutter counts from 1 and LSP counts from 0, so every value gains one on the way
 * out. Only the target for the document actually on screen is projected — a stale
 * target from a file you navigated away from is not where the link points.
 */
function focusFor(uiStoreApi: EditorUiStoreApi, activePath: string | null) {
  const target = uiStoreApi.getState().definitionTarget
  if (!target || !activePath || target.path !== activePath) return null

  const line = target.range.start.line + 1
  const endLine = target.range.end.line + 1

  return {
    column: target.range.start.character > 0 ? target.range.start.character + 1 : null,
    endLine: endLine > line ? endLine : null,
    line,
  }
}

/**
 * Only projected while a settings tab is actually open — the category store keeps its
 * pick after you close the tab, and a link that reopened settings because of a
 * remembered section would be the opposite of "an open menu is never a place".
 */
function settingsCategoryOrNull() {
  const category = readSettingsCategory()

  return category ? settingsCategorySlug(category) : null
}

/**
 * A slot sitting at its default is ABSENT from the address, not present-and-equal.
 * §1's rule is that an absent field defers to the remembered slice, so emitting the
 * default would make every shared link force the recipient's sidebar to `files` and
 * their bottom panel to `terminal` — panels they never chose.
 */
function orAbsent<T>(value: T | null, fallback: T) {
  return value === fallback ? null : value
}

/**
 * The scope of the session on stage, not of every remembered session. Only chat mode
 * shows it, and only the selected session's pick is where the user is.
 */
function sessionDiffScopeParam() {
  const selection = useSessionSelectionStore.getState().selection
  if (selection.kind !== 'session') return null

  const entry = useSessionDiffScopeStore.getState().scopeBySessionKey[scopedSessionKey(selection)]

  return entry ? diffScopeParam(entry.scope) : null
}
