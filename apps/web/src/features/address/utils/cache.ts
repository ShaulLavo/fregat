import { contentForDocumentToken } from '@/features/address/utils/document-token'
import {
  applicableTabs,
  editorDocumentToken,
  type Address,
} from '@workspace/client-core/address/grammar'
import { NO_WORKSPACE_TOKEN, parseWorkspaceToken } from '@workspace/client-core/address/workspace'
import { isChatModeToolTab, showChatModeToolTab } from '@/features/chat-mode/utils/panels'
import {
  activeEditorTabForWorkbenchPanels,
  openEditorContentInWorkbenchPanels,
  selectEditorTabInWorkbenchPanels,
  setWorkbenchBottomTab,
  setWorkbenchSidebarTab,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import type { CachedWorkspaceState } from '@/features/workspace/state/cache'

/**
 * The address, folded into the cache before the stores are built.
 *
 * This is what makes the address a peer of the cache rather than an overlay on top of
 * it. `EditorStateProvider` seeds every store from `readWorkspaceCache()` synchronously,
 * so an applier running later in an effect necessarily restores twice — once from the
 * cache, then again from a lossier address that has to overwrite what it does not name.
 * Merging first means one restore, no race, and nothing to undo.
 *
 * Deliberately pure and total: no store, no network, no clock. Anything it cannot decide
 * from `localStorage` alone is left to the post-mount applier, which can await.
 */

/**
 * Tabs UNION rather than replace here, which is the one place this differs from a
 * popstate apply. At boot the address may be a link someone else wrote, and a stranger's
 * two-tab link is not an instruction to close the ten tabs you had open. Back/forward
 * still applies `?tabs=` exactly, because there the set is one this app wrote.
 */
export function addressedWorkspaceCache(
  cached: CachedWorkspaceState,
  address: Address,
): CachedWorkspaceState {
  if (address.environmentId || address.rejectedEnvironment !== null) return cached
  if (address.workspace === NO_WORKSPACE_TOKEN) {
    return { ...cached, rootFolder: null, uiMode: address.mode ?? cached.uiMode }
  }
  const rootPath = seedableRootPath(cached, address)
  if (rootPath === null) return cached

  const slice = cached.workspaces[rootPath]
  if (!slice) return cached

  return {
    ...cached,
    chatModePanels: address.tool
      ? chatModePanelsWithTool(cached.chatModePanels, address.tool)
      : cached.chatModePanels,
    uiMode: address.mode ?? cached.uiMode,
    workspaces: {
      ...cached.workspaces,
      [rootPath]: {
        ...slice,
        workbenchPanels: panelsForAddress(slice.workbenchPanels, rootPath, address),
      },
    },
  }
}

/**
 * The root this function is allowed to seed: the one already open.
 *
 * A cross-workspace link is deliberately NOT handled here. The cache stores a
 * `PickedFsEntry` for the active root only, so seeding a different one would mean
 * inventing `birthtimeMs`, `mtimeMs` and `size` — and `useValidateRootFolder` only
 * clears an invalid root, it never replaces the entry, so the fabricated stat would
 * outlive the boot it was invented for. Switching projects stays with the post-mount
 * applier, which can await a real `statPath`.
 */
function seedableRootPath(cached: CachedWorkspaceState, address: Address) {
  const openRootPath = cached.rootFolder?.path
  if (openRootPath === undefined) return null
  if (!address.workspace) return null

  const resolution = parseWorkspaceToken(address.workspace)
  if (resolution.kind !== 'workspace') return null
  if (resolution.id !== cached.rootFolder?.workspaceAddress?.id) return null

  return openRootPath
}

export function panelsForAddress(
  panels: WorkbenchPanels,
  rootPath: string | null,
  address: Address,
) {
  const active = activeEditorTabForWorkbenchPanels(panels)
  const withPanes = withBottomTab(withSidebarTab(panels, address), address)
  const withTabs = (applicableTabs(address.tabs) ?? []).reduce(
    (next, token) => withDocumentToken(next, rootPath, token),
    withPanes,
  )
  const selected = editorDocumentToken(address)
  if (selected) return withDocumentToken(withTabs, rootPath, selected)
  if (active) return selectEditorTabInWorkbenchPanels(withTabs, active.id)

  return withTabs
}

function withDocumentToken(panels: WorkbenchPanels, rootPath: string | null, token: string) {
  const parsed = contentForDocumentToken(rootPath, token)
  if (parsed.kind !== 'content') return panels

  return openEditorContentInWorkbenchPanels(panels, parsed.content)
}

function withSidebarTab(panels: WorkbenchPanels, address: Address) {
  return address.side ? setWorkbenchSidebarTab(panels, address.side) : panels
}

function withBottomTab(panels: WorkbenchPanels, address: Address) {
  return address.bottom ? setWorkbenchBottomTab(panels, address.bottom) : panels
}

function chatModePanelsWithTool(panels: CachedWorkspaceState['chatModePanels'], tool: string) {
  if (!isChatModeToolTab(tool)) return panels
  if (panels.activeToolTab === tool) return panels

  return showChatModeToolTab(panels, tool)
}
