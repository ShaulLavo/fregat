import { addressHrefFromBrowser } from '@/features/address/utils/browser-url'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { useEffect } from 'react'

import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import type { Client } from '@/lib/client'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'

import {
  applicableTabs,
  editorDocumentToken,
  parseAddress,
} from '@workspace/client-core/address/grammar'
import { pathForDocumentToken } from '@/features/address/utils/document-token'
import { parseWorkspaceToken, NO_WORKSPACE_TOKEN } from '@workspace/client-core/address/workspace'
import { readWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { parseSessionToken } from '@/features/address/utils/session-token'
import { claimAddressRoot } from '@/features/address/state/root-claim'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import { diffScopeFor } from '@/features/address/utils/diff-scope'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { showChatModeToolTab, isChatModeToolTab } from '@/features/chat-mode/utils/panels'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { selectSessionOwnership, selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { addressEnvironments } from '@/features/address/utils/environments'
import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { errorMessage } from '@/lib/error-message'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { createEditorCommands } from '@/features/editor/state/commands'
import { settingsCategoryForSlug } from '@/features/address/utils/settings-category'
import { isEditorTabDirty } from '@/features/workspace/utils/tab-dirty'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { SETTING_IDS, descriptorFor, type EnvironmentId } from '@workspace/contracts'
import { searchStateFor } from '@/features/address/utils/search-params'
import { logsFiltersFor } from '@/features/address/utils/logs-params'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { resetLogsFilters, setLogsFilters } from '@/features/logs/state/filter-store'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { useEditorCommands } from '@/features/editor/state/commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { documentTokenForPath } from '@/features/address/utils/document-token'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  activeEditorTabForWorkbenchPanels,
  createDefaultWorkbenchPanels,
  setWorkbenchBottomTab,
  setWorkbenchSidebarTab,
} from '@/features/workbench/utils/panels'
import { toast } from 'sonner'

import { log } from '@/lib/client-logging'

/**
 * The inbound edge for everything `addressedWorkspaceCache` could not decide.
 *
 * That merge runs before the stores exist and owns the slots a workspace slice can
 * hold — mode, panels, tabs, the active document — for the workspace already open. What
 * is left here is the rest: a cross-workspace switch, which needs a real `statPath`, and
 * the slots no slice holds at all (settings, search, logs, chat selection).
 *
 * Everything is applied through domain actions in slot order — workspace, mode,
 * document, panel — never through raw setters. Three consequences: the URL cannot
 * express invalid state; the applier inherits the existing supersede protocol rather
 * than competing with it (`useOpenWorkspaceRoot` still arbitrates which project
 * switch won); and panels go through the store's own setter, which normalizes, so the
 * store can never end up claiming a file is selected while the editor pane shows
 * nothing.
 *
 * On BOOT an absent field means "defer to the remembered slice", never "reset to
 * default", so a short link lands somewhere sane instead of flattening everything it
 * does not name. On POPSTATE the address is authoritative — it is one this app wrote —
 * so an absent field means the default, and back is the inverse of forward.
 */

/**
 * Why the address is being applied, which decides two things a boot and a back press
 * must not share.
 *
 * `boot` may find the work already done: when the address names the workspace that is
 * already open, the provider's merge has seeded mode, panels and tabs, and re-applying
 * them would be redundant at best. `boot` also never CLOSES a tab, because the address
 * may be a link someone else wrote.
 *
 * `popstate` always applies in full and does close tabs, because there the tab set is
 * one this app wrote and back has to be the inverse of push.
 */
type ApplyReason = 'boot' | 'popstate'

/**
 * Everything worth knowing about one restore, accumulated so it can leave as a single
 * wide event. Applying an address used to emit up to four narrow lines — one per
 * rejected token, plus the tab cap, plus the slug warning, plus the outcome — which is
 * the shape the evlog rule exists to prevent: the pieces were only correlatable by
 * timestamp, and a boot that rejected three tokens looked like three unrelated faults.
 */
type ApplyTrace = {
  workspaceSource: 'cache' | 'server' | 'session' | null
  workspaceId: string | null
  rejectedTokens: string[]
  tabsRejected: number | null
}

function emptyApplyTrace(): ApplyTrace {
  return { workspaceSource: null, workspaceId: null, rejectedTokens: [], tabsRejected: null }
}

export type AddressRestoreResult =
  | { readonly status: 'applied'; readonly reason: ApplyReason }
  | { readonly status: 'pending'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string }

export function useAddressRestore() {
  const application = useApplicationRuntime()
  const runtime = useEditorRuntime()

  useEffect(() => {
    const deps = { application }
    if (runtime.claimAddressRestore()) {
      // Claimed synchronously, BEFORE the first await, and released however the apply
      // ends. `useRestoreRecentWorkspaceRoot` fills the same empty root slot, and this
      // path has to resolve a slug — sometimes over the network — before it can name
      // its root, so without the claim the recents fallback opens a different project
      // first and the pasted link is lost to a supersede that looks routine.
      const releaseRoot = addressNamesWorkspace() ? claimAddressRoot() : undefined
      void applyAddress(deps, 'boot').finally(releaseRoot)
    }

    // The second inbound edge. `pushState`/`replaceState` do not emit `popstate`, so
    // the projection's own writes cannot echo back here — only a real back, forward,
    // mouse-back or trackpad swipe reaches this listener.
    function applyOnPopState() {
      const releaseRoot = claimAddressRoot()
      void applyAddress(deps, 'popstate').finally(releaseRoot)
    }

    window.addEventListener('popstate', applyOnPopState)
    return () => window.removeEventListener('popstate', applyOnPopState)
  }, [application, runtime])
}

// Every navigation supersedes older asynchronous restores, including addresses we reject.
let restoreGeneration = 0

/** Whether the URL names a real workspace, decidable before any await. */
function addressNamesWorkspace() {
  const workspace = parseAddress(addressHrefFromBrowser(window.location.href)).workspace

  return Boolean(workspace) && workspace !== NO_WORKSPACE_TOKEN
}

async function applyAddress(
  deps: { application: ApplicationRuntime },
  reason: ApplyReason,
): Promise<AddressRestoreResult> {
  const generation = ++restoreGeneration
  const trace = emptyApplyTrace()
  try {
    return await applyCurrentAddress(deps, reason, generation, trace)
  } catch (error) {
    if (generation !== restoreGeneration)
      return report({ status: 'pending', reason: 'superseded' }, trace)
    return report(
      { status: 'unavailable', reason: errorMessage(error, 'The address could not be restored.') },
      trace,
    )
  }
}

async function applyCurrentAddress(
  { application }: { application: ApplicationRuntime },
  reason: ApplyReason,
  generation: number,
  trace: ApplyTrace,
): Promise<AddressRestoreResult> {
  const environments = addressEnvironments(useEnvironmentsStore.getState().entries)
  const address = parseAddress(addressHrefFromBrowser(window.location.href), environments)
  if (address.rejectedEnvironment !== null) {
    trace.rejectedTokens.push('environment id')
    return report({ status: 'unavailable', reason: 'unknown environment' }, trace)
  }
  const environmentId = address.environmentId ?? environments.primaryEnvironmentId
  if (environmentId) application.activateEnvironment(confirmedEnvironmentOrigin(environmentId))
  const owner = application.getSnapshot()
  const editor = owner.editor
  const storeApi = editor.workspaceStore
  const documentStoreApi = editor.documentStore
  const searchStoreApi = editor.searchBufferStore
  const commands = createEditorCommands({
    activation: editor.editorActivation,
    documentStore: documentStoreApi,
    searchStore: searchStoreApi,
    uiStore: editor.uiStore,
    workspaceStore: storeApi,
  })
  const client = clientForQueryClient(owner.queryClient)
  const activity = environmentActivitySignal(owner.origin)
  if (activity.aborted) return report({ status: 'pending', reason: 'superseded' }, trace)
  const superseded = () => activity.aborted || generation !== restoreGeneration
  if (!address.workspace) {
    return report({ status: 'pending', reason: 'no address to apply' }, trace)
  }
  if (address.workspace === NO_WORKSPACE_TOKEN) {
    applyMode(address.mode, storeApi)
    applyPanels(address, storeApi, reason)
    applyTabs(address, null, commands, storeApi, documentStoreApi, reason, trace)
    applyDocument(address, null, commands, trace)
    applySettingsCategory(address)
    return report({ status: 'applied', reason }, trace)
  }

  if (address.mode === 'chat' && environmentId) {
    const snapshot = await fetchOrchestrationShellSnapshotHttp(client)
    if (superseded()) return report({ status: 'pending', reason: 'superseded' }, trace)
    confirmedEnvironmentId(owner.origin)
    useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
  }
  const selectedRoot = environmentId ? checkoutPathForAddress(address, environmentId) : null
  if (selectedRoot !== null) trace.workspaceSource = 'session'
  let rootPath =
    selectedRoot ?? (await resolveRoot(address.workspace, storeApi, trace, client, activity))
  // A newer press started while this one was resolving. Everything below writes store
  // state, so continuing would drag the older address over the newer one.
  if (superseded()) return report({ status: 'pending', reason: 'superseded' }, trace)
  confirmedEnvironmentId(owner.origin)
  if (rootPath === null) {
    return report(
      {
        status: 'unavailable',
        reason:
          'The link does not contain a valid workspace ID. Open the folder and copy its new link.',
      },
      trace,
    )
  }

  // Whether the provider's merge already seeded the slice slots. It only ever seeds the
  // workspace that was already open, so a switch below always leaves this false.
  const seeded = reason === 'boot' && storeApi.getState().rootFolder?.path === rootPath

  if (storeApi.getState().rootFolder?.path !== rootPath) {
    if (!environmentId)
      return report({ status: 'pending', reason: 'machine identity is unconfirmed' }, trace)
    const outcome = await application.openEnvironmentWorkspaceRoot(environmentId, rootPath)
    // `superseded` means another project switch won while this one was in flight.
    // Applying the rest would drag that project's tabs into the winner.
    if (outcome === 'superseded') {
      return report({ status: 'pending', reason: 'superseded' }, trace)
    }
    if (outcome === 'failed') {
      return report({ status: 'unavailable', reason: 'root failed to open' }, trace)
    }
    if (superseded()) return report({ status: 'pending', reason: 'superseded' }, trace)
  }

  confirmedEnvironmentId(owner.origin)
  rootPath = storeApi.getState().rootFolder?.path ?? rootPath
  if (!seeded) {
    applyMode(address.mode, storeApi)
    applyPanels(address, storeApi, reason)
    if (address.mode === 'chat') applyChatToolTab(address, storeApi)
    applyTabs(address, rootPath, commands, storeApi, documentStoreApi, reason, trace)
  }

  // Select after opening the tab collection, including links that omit the collection.
  applyDocument(address, rootPath, commands, trace)
  applySettingsCategory(address)

  // Always applied: none of these lives in a workspace slice, so the merge cannot
  // reach them however the address arrived.
  if (address.mode === 'chat' && environmentId)
    applyChatSelection(address, environmentId, rootPath, trace)
  applySearch(address, rootPath, searchStoreApi, reason)
  applyLogs(address, reason)

  return report({ status: 'applied', reason }, trace)
}

function checkoutPathForAddress(
  address: ReturnType<typeof parseAddress>,
  environmentId: EnvironmentId,
) {
  if (address.mode !== 'chat') return null
  const parsed = parseSessionToken(address.document)
  if (parsed?.kind !== 'session') return null
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  return selectSessionOwnership(slice, parsed.sessionId)?.worktree.path ?? null
}

async function resolveRoot(
  token: string,
  storeApi: ReturnType<typeof useEditorWorkspaceStoreApi>,
  trace: ApplyTrace,
  client: Client,
  activity: AbortSignal,
) {
  const parsed = parseWorkspaceToken(token)
  if (parsed.kind !== 'workspace') return null

  trace.workspaceId = parsed.id
  const root = storeApi.getState().rootFolder
  if (root?.workspaceAddress?.id === parsed.id) {
    trace.workspaceSource = 'cache'
    return root.path
  }

  trace.workspaceSource = 'server'
  const workspace = await readWorkspaceAddress({ client, id: parsed.id, signal: activity })
  return workspace.path
}

function applyMode(
  mode: ReturnType<typeof parseAddress>['mode'],
  storeApi: ReturnType<typeof useEditorWorkspaceStoreApi>,
) {
  if (!mode) return

  storeApi.getState().setUiMode(mode)
}

function applyDocument(
  address: ReturnType<typeof parseAddress>,
  rootPath: string | null,
  commands: ReturnType<typeof useEditorCommands>,
  trace: ApplyTrace,
) {
  const token = editorDocumentToken(address)
  if (!token) return

  const parsed = pathForDocumentToken(rootPath, token)
  if (parsed.kind !== 'path') {
    // Recorded rather than swallowed: a token that parses to nothing is otherwise a
    // blank tab with no error anywhere.
    trace.rejectedTokens.push(parsed.reason)
    return
  }

  // `openDefinition` opens the path AND sets the target the editor scrolls to, so a
  // focused link is one call rather than an open followed by a racing scroll.
  if (address.focus) {
    commands.openDefinition(definitionTargetFor(parsed.path, address.focus))
    return
  }

  commands.openFileSurface(parsed.path)
}

/**
 * `#L484`, `#L21,9`, `#L484-L520` are 1-based, the way an editor gutter counts.
 * LSP positions are 0-based, so every value loses one on the way in.
 */
function definitionTargetFor(
  path: string,
  focus: NonNullable<ReturnType<typeof parseAddress>['focus']>,
) {
  const line = Math.max(0, focus.line - 1)
  const character = Math.max(0, (focus.column ?? 1) - 1)
  const endLine = focus.endLine ? Math.max(line, focus.endLine - 1) : line

  return {
    path,
    range: {
      end: { character: focus.endLine ? 0 : character, line: endLine },
      start: { character, line },
    },
    uri: `file://${path.startsWith('/') ? path : `/${path}`}`,
  }
}

/**
 * The chat session on stage, plus the rail and diff scope that belong to it. None of
 * these lives in a workspace slice, so this runs however the address arrived.
 */
function applyChatSelection(
  address: ReturnType<typeof parseAddress>,
  environmentId: EnvironmentId,
  rootPath: string,
  trace: ApplyTrace,
) {
  const parsed = parseSessionToken(address.document)
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  const worktree = selectWorktreeAtPath(slice, rootPath)
  if (!worktree) {
    trace.rejectedTokens.push('worktree id')
    return
  }
  if (parsed?.kind === 'session') {
    const ownership = selectSessionOwnership(slice, parsed.sessionId)
    if (ownership?.worktree.id !== worktree.id) {
      trace.rejectedTokens.push('session id')
      return
    }
    useSessionSelectionStore
      .getState()
      .restoreSession(environmentId, ownership.project.id, parsed.sessionId)
  }
  if (parsed?.kind === 'draft') {
    useSessionSelectionStore.getState().startDraft(environmentId, worktree.projectId)
  }
  if (parsed?.kind === 'rejected') trace.rejectedTokens.push('session id')

  if (address.rail === 'archived') useSessionRailStore.getState().setView('archived')

  // Applied through the store's own action, and only for the session the address names —
  // a scope belongs to a conversation, not to the window.
  const scope = diffScopeFor(address.diff)
  if (scope && parsed?.kind === 'session') {
    useSessionDiffScopeStore
      .getState()
      .selectSessionDiffScope({ environmentId, sessionId: parsed.sessionId }, scope)
  }
}

/**
 * `?tool=git` selects git and opens the pane exactly as clicking it would, without
 * `toolPaneOpen` ever being serialized. Only applied when it actually differs:
 * `showChatModeToolTab` forces the pane open, and re-applying the tab a user had
 * already collapsed would reopen it on every reload.
 */
function applyChatToolTab(
  address: ReturnType<typeof parseAddress>,
  storeApi: ReturnType<typeof useEditorWorkspaceStoreApi>,
) {
  const state = storeApi.getState()
  const panels = state.chatModePanels
  if (!address.tool || !isChatModeToolTab(address.tool)) return
  if (panels.activeToolTab === address.tool) return

  state.setChatModePanels(showChatModeToolTab(panels, address.tool))
}

/**
 * On boot an absent `?side=`/`?bottom=` defers to the remembered slice. On popstate it
 * means the DEFAULT, because the encoder omits a slot sitting at its default
 * (`orAbsent` in `use-projection.ts`) — so treating absence as "leave it alone" made
 * back stop being the inverse of forward: you returned to an earlier document still
 * wearing the panels you had switched to after leaving it.
 */
function applyPanels(
  address: ReturnType<typeof parseAddress>,
  storeApi: ReturnType<typeof useEditorWorkspaceStoreApi>,
  reason: ApplyReason,
) {
  const state = storeApi.getState()
  const defaults = createDefaultWorkbenchPanels()
  const side = address.side ?? (reason === 'popstate' ? defaults.activeSidebarTab : null)
  const bottom = address.bottom ?? (reason === 'popstate' ? defaults.activeBottomTab : null)
  let panels = state.workbenchPanels

  if (side) panels = setWorkbenchSidebarTab(panels, side)
  if (bottom) panels = setWorkbenchBottomTab(panels, bottom)
  if (panels === state.workbenchPanels) return

  state.setWorkbenchPanels(panels)
}

function applySettingsCategory(address: ReturnType<typeof parseAddress>) {
  const categories = SETTING_IDS.map((id) => descriptorFor(id).category)
  selectSettingsCategory(
    address.settings ? settingsCategoryForSlug(address.settings, categories) : null,
  )
}

/**
 * Query and flags only. Results are not restored — they re-run, which is the whole
 * reason they are not in the address — and `replaceText` has no field to restore
 * from.
 */
function applySearch(
  address: ReturnType<typeof parseAddress>,
  rootPath: string,
  searchStoreApi: SearchBufferStoreApi,
  reason: ApplyReason,
) {
  const wanted = searchStateFor(address.search)
  // Absence is authoritative on popstate: the encoder emits `s.q` whenever there is a
  // query, so an address without one is an address where the box was empty. Deferring
  // there left a query the user typed AFTER the entry they just walked back to.
  if (!wanted?.query) {
    if (reason === 'popstate') clearSearchQuery(rootPath, searchStoreApi)
    return
  }

  const store = searchStoreApi.getState()
  store.prepareBuffer(rootPath)
  store.setSearchOptions(rootPath, {
    caseSensitive: wanted.caseSensitive,
    excludeGlobText: wanted.excludeGlobText,
    filtersVisible: Boolean(wanted.includeGlobText || wanted.excludeGlobText),
    includeGlobText: wanted.includeGlobText,
    matchMode: wanted.matchMode as never,
    wholeWord: wanted.wholeWord,
  })
  store.setQuery(rootPath, wanted.query)
}

/**
 * Only the buffer that already exists — restoring a document must not mint one — and
 * only when that buffer is the one being cleared. The guard reads `active` while the
 * write targets `rootPath`, so without the root check a buffer belonging to another
 * workspace could satisfy the guard and send `setQuery` at a buffer nobody looked at.
 */
function clearSearchQuery(rootPath: string, searchStoreApi: SearchBufferStoreApi) {
  const active = searchStoreApi.getState().active
  if (!active?.query) return
  if (active.rootPath !== rootPath) return

  searchStoreApi.getState().setQuery(rootPath, '')
}

/**
 * `logsParamsFor` emits only what differs from the defaults, so on popstate no `log.*`
 * means the filters were untouched at that entry — reset them rather than leaving the
 * ones set after it.
 */
function applyLogs(address: ReturnType<typeof parseAddress>, reason: ApplyReason) {
  const filters = logsFiltersFor(address.logs, defaultLogsFilterState())
  if (filters) {
    setLogsFilters(filters)
    return
  }

  // `resetLogsFilters`, not a defaults snapshot: storing one would freeze
  // `logs.defaultTimeRange` for the session and leak `log.*` back into every address.
  if (reason === 'popstate') resetLogsFilters()
}

/**
 * Opened before the active document so the active one ends up selected. Tokens that
 * do not parse are skipped one at a time — a stale entry costs its own tab and
 * nothing else.
 */
function applyTabs(
  address: ReturnType<typeof parseAddress>,
  rootPath: string | null,
  commands: ReturnType<typeof useEditorCommands>,
  storeApi: ReturnType<typeof useEditorWorkspaceStoreApi>,
  documentStoreApi: ReturnType<typeof useEditorDocumentStoreApi>,
  reason: ApplyReason,
  trace: ApplyTrace,
) {
  if (!address.tabs?.length) return

  // Bounded on apply as well as on encode, by the same rule the boot merge uses. The
  // encoder caps what IT writes, which says nothing about a hand-edited or hostile
  // link: without this, `?tabs=` with 5000 tokens opens 5000 editor tabs in one
  // synchronous loop.
  const tabs = applicableTabs(address.tabs)
  if (!tabs) {
    trace.tabsRejected = address.tabs.length
    return
  }

  const active = activeEditorTabForWorkbenchPanels(storeApi.getState().workbenchPanels)
  const selected = editorDocumentToken(address)
  for (const token of tabs) {
    const parsed = pathForDocumentToken(rootPath, token)
    if (parsed.kind !== 'path') continue

    commands.openFileSurface(parsed.path)
  }

  // Only a back press closes tabs. On boot the address may be a link someone else
  // wrote, and a stranger's two-tab link is not an instruction to delete the ten tabs
  // you had open — the cache persistence would then write that deletion to disk 350ms
  // later, surviving the restart. Walking history is the only case where the tab set
  // is one this app wrote, and therefore the only case where absence means "close".
  if (reason === 'popstate') {
    const wanted = selected ? [...tabs, selected] : tabs
    closeTabsOutsideAddress(wanted, rootPath, commands, storeApi, documentStoreApi)
  }
  if (selected || !active) return
  if (!storeApi.getState().workbenchPanels.editorTabs.some((tab) => tab.id === active.id)) return

  commands.openFileSurface(active.path)
}

/**
 * Makes back the inverse of push. Without this the applier only ever ADDED tabs, so
 * walking history moved the selection while every tab you had ever opened stayed put.
 *
 * Two kinds are deliberately never closed. A tab with no token — a conflict diff, a
 * document outside the workspace — was never representable in `?tabs=`, so its absence
 * from the set means nothing. And a tab with unsaved edits is never closed silently:
 * the address is not worth someone's work.
 */
function closeTabsOutsideAddress(
  tokens: readonly string[],
  rootPath: string | null,
  commands: ReturnType<typeof useEditorCommands>,
  storeApi: ReturnType<typeof useEditorWorkspaceStoreApi>,
  documentStoreApi: ReturnType<typeof useEditorDocumentStoreApi>,
) {
  const wanted = new Set(tokens)
  const dirty = documentStoreApi.getState().dirtyFilePaths

  for (const tab of storeApi.getState().workbenchPanels.editorTabs) {
    const token = documentTokenForPath(rootPath, tab.path)
    if (token.kind !== 'token') continue
    if (wanted.has(token.token)) continue
    if (isEditorTabDirty(tab.path, dirty)) continue

    commands.closeTab(tab.id)
  }
}

/**
 * A dead link is the one failure the user has to be told about.
 *
 * Every other outcome degrades into something reasonable, but an address naming a
 * workspace this machine does not have silently lands the recipient on their own last
 * session — which looks exactly like the link having worked. The three-state result was
 * being computed and logged with nothing rendering it; this is the missing surface.
 */
function reportUnavailable(result: AddressRestoreResult) {
  if (result.status !== 'unavailable') return result

  toast.error('This workspace link could not be opened', {
    description: result.reason,
  })

  return result
}

function report(result: AddressRestoreResult, trace: ApplyTrace) {
  log.info({
    action: 'address.restored',
    workspaceSource: trace.workspaceSource,
    workspaceId: trace.workspaceId,
    area: 'address',
    reason: 'reason' in result ? result.reason : null,
    rejectedTokenCount: trace.rejectedTokens.length,
    rejectedTokenReasons: trace.rejectedTokens,
    status: result.status,
    tabsRejected: trace.tabsRejected,
  })

  return reportUnavailable(result)
}
