import type { Address } from '@workspace/client-core/address/grammar'
import { descriptorFor, SETTING_IDS } from '@workspace/contracts'
import type { AddressApplyReason } from '@/features/address/state/apply-view'
import { settingsCategoryForSlug } from '@/features/address/utils/settings-category'
import { searchStateFor } from '@/features/address/utils/search-params'
import { logsFiltersFor } from '@/features/address/utils/logs-params'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import {
  createDefaultChatModePanels,
  isChatModeToolTab,
  showChatModeToolTab,
} from '@/features/chat-mode/utils/panels'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { resetLogsFilters, setLogsFilters } from '@/features/logs/state/filter-store'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import {
  createDefaultWorkbenchPanels,
  setWorkbenchBottomTab,
  setWorkbenchSidebarTab,
} from '@/features/workbench/utils/panels'

export function applyAddressFields({
  address,
  workspaceStore,
  searchStore,
  rootPath,
  reason,
}: {
  readonly address: Address
  readonly workspaceStore: EditorWorkspaceStoreApi
  readonly searchStore: SearchBufferStoreApi
  readonly rootPath: string | null
  readonly reason: AddressApplyReason
}) {
  const state = workspaceStore.getState()
  const mode = address.mode ?? (reason === 'boot' ? null : 'workbench')
  if (mode) state.setUiMode(mode)
  if (address.settings || reason !== 'boot') applySettingsCategory(address)
  if (reason === 'traverse') {
    if (address.mode === 'chat' && address.editor && address.tool === 'editor')
      state.setChatModePanels(showChatModeToolTab(state.chatModePanels, 'editor'))
    if (address.chat)
      state.setWorkbenchPanels({
        ...state.workbenchPanels,
        activeSidebarTab: 'chat',
        sidebarOpen: true,
      })
    return
  }
  applyPanels(address, workspaceStore, reason)
  applyTool(address, workspaceStore, reason)
  if (address.rail || reason !== 'boot')
    useSessionRailStore.getState().setView(address.rail ?? 'active')
  if (rootPath !== null) applySearch(address, rootPath, searchStore, reason)
  applyLogs(address, reason)
}

function applyPanels(address: Address, store: EditorWorkspaceStoreApi, reason: AddressApplyReason) {
  const state = store.getState()
  const defaults = createDefaultWorkbenchPanels()
  const side = address.side ?? (reason !== 'boot' ? defaults.activeSidebarTab : null)
  const bottom = address.bottom ?? (reason !== 'boot' ? defaults.activeBottomTab : null)
  let panels = state.workbenchPanels
  if (side && panels.activeSidebarTab !== side) panels = setWorkbenchSidebarTab(panels, side)
  if (bottom && panels.activeBottomTab !== bottom) panels = setWorkbenchBottomTab(panels, bottom)
  if (panels !== state.workbenchPanels) state.setWorkbenchPanels(panels)
}

function applyTool(address: Address, store: EditorWorkspaceStoreApi, reason: AddressApplyReason) {
  const state = store.getState()
  const tool =
    address.tool ?? (reason !== 'boot' ? createDefaultChatModePanels().activeToolTab : null)
  if (!isChatModeToolTab(tool)) return
  if (state.chatModePanels.activeToolTab === tool) return
  state.setChatModePanels(
    address.tool
      ? showChatModeToolTab(state.chatModePanels, tool)
      : { ...state.chatModePanels, activeToolTab: tool },
  )
}

function applySettingsCategory(address: Address) {
  const categories = SETTING_IDS.map((id) => descriptorFor(id).category)
  selectSettingsCategory(
    address.settings ? settingsCategoryForSlug(address.settings, categories) : null,
  )
}

function applySearch(
  address: Address,
  rootPath: string,
  store: SearchBufferStoreApi,
  reason: AddressApplyReason,
) {
  const wanted = searchStateFor(address.search)
  if (!wanted && reason === 'boot') return
  const state = store.getState()
  if (!wanted && state.active?.rootPath !== rootPath) return
  const prepared = state.prepareBuffer(rootPath)
  const inherited = reason === 'boot' ? prepared : null
  const includeGlobText =
    wanted?.includeGlobText ?? (inherited?.filtersVisible ? inherited.includeGlobText : '')
  const excludeGlobText =
    wanted?.excludeGlobText ?? (inherited?.filtersVisible ? inherited.excludeGlobText : '')
  const hasGlobs = Boolean(includeGlobText || excludeGlobText)
  const emptyFiltersOpen =
    prepared.filtersVisible && !prepared.includeGlobText && !prepared.excludeGlobText
  state.setSearchOptions(rootPath, {
    caseSensitive: wanted?.caseSensitive ?? inherited?.caseSensitive ?? false,
    excludeGlobText: hasGlobs ? excludeGlobText : prepared.excludeGlobText,
    filtersVisible: hasGlobs || emptyFiltersOpen,
    includeGlobText: hasGlobs ? includeGlobText : prepared.includeGlobText,
    matchMode: searchMatchMode(wanted?.matchMode ?? inherited?.matchMode),
    wholeWord: wanted?.wholeWord ?? inherited?.wholeWord ?? false,
  })
  state.setQuery(rootPath, wanted?.query ?? inherited?.query ?? '')
}

function searchMatchMode(mode: string | undefined) {
  if (mode === 'regex' || mode === 'fuzzy') return mode
  return 'literal'
}

function applyLogs(address: Address, reason: AddressApplyReason) {
  const filters = logsFiltersFor(address.logs, defaultLogsFilterState())
  if (filters) {
    setLogsFilters(filters)
    return
  }
  if (reason !== 'boot') resetLogsFilters()
}
