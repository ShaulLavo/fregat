import { readReloadCache } from '@/lib/reload-cache'
import { entryTypeSchema, workspaceSearchMatchSchema } from '@workspace/contracts'
import {
  workspaceLocation,
  workspaceLocationId,
  workspaceLocationSchema,
  locationWorktreeId,
  type WorkspaceLocation,
  type WorktreeIdsByRootPath,
} from '@/features/workspace/utils/location'
import { type ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { createDefaultGitHistoryView, gitHistoryViewSchema } from '@/lib/git-history-view'
import type { PickedFsEntry } from '@/lib/file-system-types'
import {
  createDefaultChatModePanels,
  isChatModeToolTab,
  type ChatModePanels,
  type ChatModeToolTab,
} from '@/features/chat-mode/utils/panels'
import type { ChatSelection } from '@/lib/chat-selection'
import {
  createDefaultWorkbenchLayout,
  normalizeWorkbenchLayout,
  type WorkbenchLayout,
} from '@/features/workbench/utils/layout'
import { DEFAULT_WORKSPACE_UI_MODE, isWorkspaceUiMode, type WorkspaceUiMode } from '@/lib/ui-mode'
import {
  createDefaultWorkbenchPanels,
  normalizeWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { log } from '@/lib/client-logging'
import { removeEditorVisibleSnapshotCacheForRoot } from '@/lib/editor-visible-snapshot-cache'
import {
  WORKSPACE_CACHE_STORAGE_NAMESPACE as CACHE_KEY_NAMESPACE,
  WORKSPACE_CACHE_STORAGE_PREFIX as CACHE_KEY_PREFIX,
  WORKSPACE_CACHE_VERSION as CACHE_VERSION,
  readWorkspaceCacheEntry as readCacheEntry,
  removeWorkspaceCacheEntry as removeCacheEntry,
  workspaceCacheStorageKey,
  writeWorkspaceCacheEntry as writeCacheEntry,
} from '@/lib/workspace-cache-storage'
import { filesystemPath, tabId, workspaceRoot } from '@/lib/documents/utils/identity'
import { tabContentKey } from '@/lib/documents/utils/tabs'
import {
  encodeTabContent,
  decodeTabContent,
  storedTabContentSchema,
  type StoredTabContent,
} from '@/lib/documents/utils/storage-codec'
import type {
  EditorViewScrollPosition,
  ReopenScrollPosition,
  TabContent,
  TabId,
  WorkspaceRoot,
} from '@/lib/documents/utils/types'
import {
  environmentIdSchema,
  workspaceAddressSchema,
  projectIdSchema,
  sessionIdSchema,
  type WorktreeId,
  type WorkspaceSearchMatch,
  type WorkspaceSearchMatchMode,
  type WorkspaceSearchQuery,
  type WorkspaceSearchWarningEvent,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  groupId,
  splitId,
  type GroupNode,
  type GroupId,
  type SplitId,
  type GroupAxis,
} from '@/lib/documents/utils/group-types'
import { allEditorTabs, filterGroupTabs, validEditorGroups } from '@/lib/documents/utils/groups'

const WORKSPACE_SLICE_KEY_PREFIX = workspaceCacheStorageKey('workspace:')
const SEARCH_BUFFER_KEY_PREFIX = workspaceCacheStorageKey('search:')

/**
 * How many projects keep their tabs across restarts. Slices are small (paths and
 * ids), so the ceiling exists to bound localStorage growth over months of use,
 * not to protect any one write.
 */
export const WORKSPACE_SLICE_LIMIT = 8

export const WORKSPACE_CACHE_STORAGE_KEYS = {
  chatModePanels: workspaceCacheStorageKey('chatModePanels'),
  chatModeSelection: workspaceCacheStorageKey('chatModeSelection'),
  rootFolder: workspaceCacheStorageKey('rootFolder'),
  uiMode: workspaceCacheStorageKey('uiMode'),
  workbenchLayout: workspaceCacheStorageKey('workbenchLayout'),
  workspaceIndex: workspaceCacheStorageKey('workspaces'),
} as const

/** Per-project state lives under its own key so switching never rewrites another project's. */
export function workspaceSliceStorageKey(rootPath: string, worktreeId: WorktreeId | null = null) {
  return `${WORKSPACE_SLICE_KEY_PREFIX}${workspaceLocationId(rootPath, worktreeId)}`
}

/**
 * Search results are the one bulky entry — a full match list. Splitting them from the
 * slice keeps a quota failure on search from taking the project's open tabs with it.
 */
export function searchBufferStorageKey(rootPath: string, worktreeId: WorktreeId | null = null) {
  return `${SEARCH_BUFFER_KEY_PREFIX}${workspaceLocationId(rootPath, worktreeId)}`
}

export type CachedSearchBufferState = {
  activeResultId: string | null
  caseSensitive: boolean
  collapsedPaths: string[]
  excludeGlobText: string
  filtersVisible: boolean
  includeGlobText: string
  matchMode: WorkspaceSearchMatchMode
  matches: WorkspaceSearchMatch[]
  query: string
  queryHistory: string[]
  replaceHistory: string[]
  replaceText: string
  replaceVisible: boolean
  resultsQuery: string
  resultsSearchQuery: WorkspaceSearchQuery | null
  rootPath: string
  totalCount: number
  truncated: boolean
  warnings: WorkspaceSearchWarningEvent[]
  wholeWord: boolean
}

const pickedEntryFields = {
  workspaceAddress: v.optional(workspaceAddressSchema),
  birthtimeMs: v.number(),
  mtimeMs: v.number(),
  name: v.string(),
  path: v.pipe(v.string(), v.transform(filesystemPath)),
  size: v.number(),
  version: v.optional(v.string(), ''),
}
const pickedDirectorySchema = v.object({
  ...pickedEntryFields,
  type: v.literal('directory'),
})
const pickedSymlinkDirectorySchema = v.object({
  ...pickedEntryFields,
  targetType: v.literal('directory'),
  type: v.literal('symlink'),
})
const rootFolderSchema = v.nullable(
  v.pipe(
    v.union([pickedDirectorySchema, pickedSymlinkDirectorySchema]),
    v.check((folder) => !folder.workspaceAddress || folder.workspaceAddress.path === folder.path),
  ),
)
const cachedRootSchema = v.pipe(
  v.object({
    folder: rootFolderSchema,
    location: v.nullable(workspaceLocationSchema),
  }),
  v.check((value) =>
    value.folder === null
      ? value.location === null
      : value.location?.rootPath === value.folder.path,
  ),
)

const nullableStringSchema = v.nullable(v.string())

const workspaceSearchMatchModeSchema = v.union([
  v.literal('literal'),
  v.literal('regex'),
  v.literal('fuzzy'),
])

const searchWarningSchema = v.object({
  code: v.union([
    v.literal('content-tool-partial-failure'),
    v.literal('file-limit-reached'),
    v.literal('multiline-query-unsupported'),
  ]),
  detail: v.optional(v.string()),
  message: v.string(),
  type: v.literal('warning'),
})
const workspaceSearchQuerySchema = v.object({
  caseSensitive: v.optional(v.boolean()),
  entryType: v.optional(entryTypeSchema),
  excludeGlobs: v.optional(v.array(v.string())),
  fileLimit: v.optional(v.number()),
  includeContent: v.boolean(),
  includeGlobs: v.optional(v.array(v.string())),
  includeNames: v.optional(v.boolean()),
  limit: v.number(),
  matchMode: v.optional(workspaceSearchMatchModeSchema),
  maxDepth: v.optional(v.number()),
  path: v.string(),
  query: v.string(),
  wholeWord: v.optional(v.boolean()),
})
const cachedSearchBufferStateSchema = v.strictObject({
  activeResultId: nullableStringSchema,
  caseSensitive: v.boolean(),
  collapsedPaths: v.array(v.string()),
  excludeGlobText: v.string(),
  filtersVisible: v.boolean(),
  includeGlobText: v.string(),
  matchMode: workspaceSearchMatchModeSchema,
  matches: v.array(workspaceSearchMatchSchema),
  query: v.string(),
  queryHistory: v.array(v.string()),
  replaceHistory: v.array(v.string()),
  replaceText: v.string(),
  replaceVisible: v.boolean(),
  resultsQuery: v.string(),
  resultsSearchQuery: v.nullable(workspaceSearchQuerySchema),
  rootPath: v.string(),
  totalCount: v.number(),
  truncated: v.boolean(),
  // Restored results carry their warnings: cached matches from a partial run are
  // still partial, and `truncated` is persisted for the same reason.
  warnings: v.optional(v.array(searchWarningSchema), []),
  wholeWord: v.boolean(),
})
const sidebarTabSchema = v.union([
  v.literal('chat'),
  v.literal('files'),
  v.literal('git'),
  v.literal('logs'),
  v.literal('search'),
])
const bottomTabSchema = v.union([v.literal('terminal'), v.literal('problems')])
const tabIdSchema = v.pipe(v.string(), v.minLength(1), v.transform(tabId))
const editorTabRecordSchema = v.strictObject({
  id: tabIdSchema,
  content: storedTabContentSchema,
})
const scrollPositionSchema = v.strictObject({
  left: v.number(),
  top: v.number(),
})
const outerLayoutSchema = v.strictObject({
  main: v.number(),
  sidebar: v.number(),
})
const mainLayoutSchema = v.strictObject({
  bottom: v.number(),
  editor: v.number(),
})
const terminalTabRecordSchema = v.strictObject({
  id: v.pipe(v.string(), v.nonEmpty()),
  name: v.nullable(v.pipe(v.string(), v.nonEmpty())),
  title: v.pipe(v.string(), v.nonEmpty()),
})
type StoredGroupNode =
  | {
      kind: 'group'
      id: GroupId
      tabs: { id: TabId; content: StoredTabContent }[]
      selectedTabId: TabId | null
    }
  | {
      kind: 'split'
      id: SplitId
      axis: GroupAxis
      children: [
        { node: StoredGroupNode; size: number },
        { node: StoredGroupNode; size: number },
        ...{ node: StoredGroupNode; size: number }[],
      ]
    }
const groupIdSchema = v.pipe(v.string(), v.nonEmpty(), v.transform(groupId))
const splitIdSchema = v.pipe(v.string(), v.nonEmpty(), v.transform(splitId))
const storedGroupNodeSchema: v.GenericSchema<unknown, StoredGroupNode> = v.lazy(() =>
  v.variant('kind', [
    v.strictObject({
      kind: v.literal('group'),
      id: groupIdSchema,
      tabs: v.array(editorTabRecordSchema),
      selectedTabId: v.nullable(tabIdSchema),
    }),
    v.strictObject({
      kind: v.literal('split'),
      id: splitIdSchema,
      axis: v.picklist(['horizontal', 'vertical']),
      children: v.tupleWithRest(
        [
          v.strictObject({
            node: storedGroupNodeSchema,
            size: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)),
          }),
          v.strictObject({
            node: storedGroupNodeSchema,
            size: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)),
          }),
        ],
        v.strictObject({
          node: storedGroupNodeSchema,
          size: v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE)),
        }),
      ),
    }),
  ]),
)
const workbenchPanelsSchema = v.strictObject({
  activeBottomTab: bottomTabSchema,
  activeGitTab: v.optional(v.picklist(['changes', 'graph']), 'changes'),
  activeSidebarTab: sidebarTabSchema,
  activeTerminalTabId: v.nullable(v.string()),
  bottomPanelOpen: v.boolean(),
  editorGroups: v.strictObject({ root: storedGroupNodeSchema, activeGroupId: groupIdSchema }),
  gitCommitDetailsOpen: v.optional(v.boolean(), true),
  gitHistory: v.optional(gitHistoryViewSchema, createDefaultGitHistoryView),
  gitChangesOpen: v.optional(v.object({ staged: v.boolean(), worktree: v.boolean() }), () => ({
    staged: true,
    worktree: true,
  })),
  sidebarOpen: v.boolean(),
  terminalTabSequence: v.pipe(v.number(), v.integer(), v.minValue(0)),
  terminalTabs: v.pipe(v.array(terminalTabRecordSchema), v.readonly()),
})
const workbenchLayoutSchema = v.strictObject({
  mainLayout: mainLayoutSchema,
  outerLayout: outerLayoutSchema,
})
const workspaceSliceSchema = v.strictObject({
  editorHistory: v.array(storedTabContentSchema),
  recentlyClosedTabs: v.array(storedTabContentSchema),
  reopenScrollPositions: v.array(
    v.strictObject({
      content: storedTabContentSchema,
      position: scrollPositionSchema,
    }),
  ),
  viewScrollPositions: v.array(
    v.strictObject({ tabId: tabIdSchema, position: scrollPositionSchema }),
  ),
  workbenchPanels: workbenchPanelsSchema,
})
type StoredWorkspaceSlice = v.InferOutput<typeof workspaceSliceSchema>

const uiModeSchema = v.custom<WorkspaceUiMode>(isWorkspaceUiMode)
const chatModePanelsSchema = v.strictObject({
  activeToolTab: v.custom<ChatModeToolTab>(isChatModeToolTab),
  sessionRailOpen: v.boolean(),
  toolPaneOpen: v.boolean(),
})
const chatModeSelectionSchema = v.union([
  v.strictObject({ kind: v.literal('auto') }),
  v.strictObject({
    kind: v.literal('draft'),
    draftId: v.optional(v.pipe(v.string(), v.uuid())),
    environmentId: environmentIdSchema,
    projectId: projectIdSchema,
  }),
  v.strictObject({
    kind: v.literal('session'),
    environmentId: environmentIdSchema,
    projectId: projectIdSchema,
    sessionId: sessionIdSchema,
  }),
])

const AUTO_SESSION_SELECTION: ChatSelection = { kind: 'auto' }

/** Each checkout keeps an independent editor slice. */
export type CachedWorkspaceSlice = {
  editorHistory: readonly TabContent[]
  recentlyClosedTabs: readonly TabContent[]
  reopenScrollPositions: readonly ReopenScrollPosition[]
  viewScrollPositions: readonly EditorViewScrollPosition[]
  workbenchPanels: WorkbenchPanels
}

export type CachedWorkspaceState = {
  worktreeIdByRootPath: WorktreeIdsByRootPath
  chatModePanels: ChatModePanels
  rootFolder: PickedFsEntry | null
  /** Restored search results, by the root path they belong to. */
  searchBuffers: Record<string, CachedSearchBufferState>
  uiMode: WorkspaceUiMode
  /** Suppresses the wallpaper image and video everywhere they are drawn. */
  workbenchLayout: WorkbenchLayout
  /** Every remembered project, active one included. Most-recent-first is `workspaceOrder`. */
  workspaces: Record<string, CachedWorkspaceSlice>
  workspaceOrder: string[]
}

export function readWorkspaceCache(storage: ScopedStorage): CachedWorkspaceState {
  purgeSupersededCacheVersions(storage)

  return workspaceStateFromCache(storage)
}

export function writeUiModeCache(uiMode: WorkspaceUiMode) {
  writeCacheEntry(WORKSPACE_CACHE_STORAGE_KEYS.uiMode, uiMode)
}

export function writeWorkbenchLayoutCache(workbenchLayout: WorkbenchLayout) {
  writeCacheEntry(WORKSPACE_CACHE_STORAGE_KEYS.workbenchLayout, workbenchLayout)
}

export function writeChatModePanelsCache(chatModePanels: ChatModePanels) {
  writeCacheEntry(WORKSPACE_CACHE_STORAGE_KEYS.chatModePanels, chatModePanels)
}

// Restore selection before mounting the environment so auto-pick cannot overwrite it.
export function readSessionSelectionCache(storage: ScopedStorage): ChatSelection {
  return readCacheEntry(
    WORKSPACE_CACHE_STORAGE_KEYS.chatModeSelection,
    chatModeSelectionSchema,
    AUTO_SESSION_SELECTION,
    { storage },
  )
}

export function writeSessionSelectionCache(storage: ScopedStorage, selection: ChatSelection) {
  writeCacheEntry(WORKSPACE_CACHE_STORAGE_KEYS.chatModeSelection, selection, {
    storage,
  })
}

export function writeRootFolderCache(
  storage: ScopedStorage,
  rootFolder: PickedFsEntry | null,
  worktreeId: WorktreeId | null = null,
) {
  writeCacheEntry(
    WORKSPACE_CACHE_STORAGE_KEYS.rootFolder,
    {
      folder: rootFolder,
      location: rootFolder ? workspaceLocation(rootFolder.path, worktreeId) : null,
    },
    { storage },
  )
}

export function writeWorkspaceSliceCache(
  storage: ScopedStorage,
  rootPath: string,
  slice: CachedWorkspaceSlice,
  worktreeId: WorktreeId | null = null,
) {
  writeCacheEntry(
    workspaceSliceStorageKey(rootPath, worktreeId),
    storedSliceForWorkspace(rootPath, slice),
    {
      storage,
    },
  )
}

const SEARCH_RELOAD_MAX_BYTES = 786_432

export function writeSearchBufferCache(
  storage: ScopedStorage,
  rootPath: string,
  searchBuffer: CachedSearchBufferState | null,
  worktreeId: WorktreeId | null = null,
) {
  if (!searchBuffer || searchBuffer.rootPath !== rootPath) {
    removeCacheEntry(searchBufferStorageKey(rootPath, worktreeId), storage)
    return
  }

  const key = searchBufferStorageKey(rootPath, worktreeId)
  if (!searchBufferFits(searchBuffer)) {
    removeCacheEntry(key, storage)
    return
  }
  const result = writeCacheEntry(key, searchBuffer, {
    storage,
    maxSerializedBytes: SEARCH_RELOAD_MAX_BYTES,
  })
  if (result.status !== 'written') removeCacheEntry(key, storage)
}

/**
 * Records which projects are remembered, newest first, and deletes the storage of any
 * that fell off. Written after the slices themselves so a crash mid-write leaves an
 * orphan slice — harmless — rather than an index pointing at nothing.
 */
export function writeWorkspaceIndexCache(
  storage: ScopedStorage,
  rootPaths: readonly string[],
  worktreeIds: WorktreeIdsByRootPath = {},
) {
  const locations = rootPaths.map((path) => workspaceLocation(path, worktreeIds[path] ?? null))
  const kept = locations.slice(0, WORKSPACE_SLICE_LIMIT)
  const keptSet = new Set(kept.map((location) => location.rootPath))
  for (const location of [...readWorkspaceIndex(storage), ...locations]) {
    if (keptSet.has(location.rootPath)) continue
    const worktreeId = locationWorktreeId(location)
    removeCacheEntry(workspaceSliceStorageKey(location.rootPath, worktreeId), storage)
    removeCacheEntry(searchBufferStorageKey(location.rootPath, worktreeId), storage)
    removeEditorVisibleSnapshotCacheForRoot(storage, location.rootPath)
  }
  writeCacheEntry(WORKSPACE_CACHE_STORAGE_KEYS.workspaceIndex, kept, {
    storage,
  })
}

function workspaceStateFromCache(storage: ScopedStorage): CachedWorkspaceState {
  const cachedRoot = readCacheEntry<{
    folder: PickedFsEntry | null
    location: WorkspaceLocation | null
  }>(
    WORKSPACE_CACHE_STORAGE_KEYS.rootFolder,
    cachedRootSchema,
    { folder: null, location: null },
    { storage },
  )
  const rootFolder = cachedRoot.folder
  const worktreeIdByRootPath: Record<string, WorktreeId> = {}
  const locations = readWorkspaceIndex(storage)
  if (cachedRoot.location) locations.push(cachedRoot.location)
  for (const location of locations) {
    if (location.kind === 'worktree') worktreeIdByRootPath[location.rootPath] = location.worktreeId
  }
  const workspaceOrder = workspaceOrderFromCache(storage, rootFolder?.path ?? null)
  const workspaces: Record<string, CachedWorkspaceSlice> = {}
  const searchBuffers: Record<string, CachedSearchBufferState> = {}

  for (const rootPath of workspaceOrder) {
    workspaces[rootPath] = readWorkspaceSlice(
      storage,
      rootPath,
      worktreeIdByRootPath[rootPath] ?? null,
    )
    const searchBuffer = readSearchBuffer(storage, rootPath, worktreeIdByRootPath[rootPath] ?? null)
    if (searchBuffer) searchBuffers[rootPath] = searchBuffer
  }

  return {
    worktreeIdByRootPath,
    chatModePanels: readCacheEntry(
      WORKSPACE_CACHE_STORAGE_KEYS.chatModePanels,
      chatModePanelsSchema,
      createDefaultChatModePanels(),
    ),
    rootFolder,
    searchBuffers,
    uiMode: readCacheEntry(
      WORKSPACE_CACHE_STORAGE_KEYS.uiMode,
      uiModeSchema,
      DEFAULT_WORKSPACE_UI_MODE,
    ),
    workbenchLayout: normalizeWorkbenchLayout(
      readCacheEntry(
        WORKSPACE_CACHE_STORAGE_KEYS.workbenchLayout,
        workbenchLayoutSchema,
        createDefaultWorkbenchLayout(),
      ),
    ),
    workspaceOrder,
    workspaces,
  }
}

/** The open root always leads, even when the index predates it or was dropped. */
function workspaceOrderFromCache(storage: ScopedStorage, activePath: string | null) {
  const stored = readWorkspaceIndex(storage).map((location) => location.rootPath)
  if (activePath === null) return stored.slice(0, WORKSPACE_SLICE_LIMIT)

  return [activePath, ...stored.filter((rootPath) => rootPath !== activePath)].slice(
    0,
    WORKSPACE_SLICE_LIMIT,
  )
}

export function readWorkspaceCheckoutIds(storage: ScopedStorage): WorktreeIdsByRootPath {
  return Object.fromEntries(
    readWorkspaceIndex(storage).flatMap((location) =>
      location.kind === 'worktree' ? [[location.rootPath, location.worktreeId]] : [],
    ),
  )
}

function readWorkspaceIndex(storage: ScopedStorage) {
  return readCacheEntry<WorkspaceLocation[]>(
    WORKSPACE_CACHE_STORAGE_KEYS.workspaceIndex,
    v.array(workspaceLocationSchema),
    [],
    { storage },
  )
}

function readWorkspaceSlice(
  storage: ScopedStorage,
  rootPath: string,
  worktreeId: WorktreeId | null,
): CachedWorkspaceSlice {
  const key = workspaceSliceStorageKey(rootPath, worktreeId)
  const stored = readCacheEntry<StoredWorkspaceSlice>(
    key,
    workspaceSliceSchema,
    storedSliceForWorkspace(rootPath, emptyWorkspaceSlice()),
    { storage },
  )
  const restored = restoredSliceForWorkspace(rootPath, stored)
  if (restored) return restored
  removeCacheEntry(key, storage)
  return emptyWorkspaceSlice()
}

function readSearchBuffer(storage: ScopedStorage, rootPath: string, worktreeId: WorktreeId | null) {
  const searchBuffer = readReloadCache<CachedSearchBufferState>(
    searchBufferStorageKey(rootPath, worktreeId),
    cachedSearchBufferStateSchema,
    storage,
    SEARCH_RELOAD_MAX_BYTES,
  )
  if (!searchBuffer) return null
  if (searchBuffer.rootPath !== rootPath) return null

  return searchBuffer
}

function storedSliceForWorkspace(
  rootPath: string,
  slice: CachedWorkspaceSlice,
): StoredWorkspaceSlice {
  const root = workspaceRoot(rootPath)
  const groups = filterGroupTabs(
    slice.workbenchPanels.editorGroups,
    (tab) => encodeTabContent(tab.content, root) !== null,
  )
  const ids = new Set(allEditorTabs(groups).map((tab) => tab.id))
  const editorGroups = { ...groups, root: storedGroupNode(groups.root, root) }
  return {
    viewScrollPositions: slice.viewScrollPositions.filter((entry) => ids.has(entry.tabId)),
    editorHistory: storedContents(root, slice.editorHistory),
    recentlyClosedTabs: storedContents(root, slice.recentlyClosedTabs),
    reopenScrollPositions: slice.reopenScrollPositions.flatMap((entry) => {
      const content = encodeTabContent(entry.content, root)
      return content === null ? [] : [{ content, position: { ...entry.position } }]
    }),
    workbenchPanels: {
      ...slice.workbenchPanels,
      editorGroups,
      terminalTabs: slice.workbenchPanels.terminalTabs.map(({ id, name, title }) => ({
        id,
        name,
        title,
      })),
    },
  }
}

function restoredSliceForWorkspace(
  rootPath: string,
  slice: StoredWorkspaceSlice,
): CachedWorkspaceSlice | null {
  const root = workspaceRoot(rootPath)
  const editorGroups = {
    ...slice.workbenchPanels.editorGroups,
    root: restoredGroupNode(slice.workbenchPanels.editorGroups.root, root),
  }
  if (!validEditorGroups(editorGroups)) return null
  const ids = new Set(allEditorTabs(editorGroups).map((tab) => tab.id))
  return {
    viewScrollPositions: slice.viewScrollPositions.filter((entry) => ids.has(entry.tabId)),
    editorHistory: restoredContents(root, slice.editorHistory),
    recentlyClosedTabs: restoredContents(root, slice.recentlyClosedTabs),
    reopenScrollPositions: slice.reopenScrollPositions.flatMap((entry) => {
      const content = decodeTabContent(entry.content, root)
      return content === null ? [] : [{ content, position: entry.position }]
    }),
    workbenchPanels: normalizeWorkbenchPanels({
      ...slice.workbenchPanels,
      editorGroups,
      terminalTabs: slice.workbenchPanels.terminalTabs.map((tab) => ({
        ...tab,
        process: null,
        shellTitle: null,
      })),
    }),
  }
}

function storedGroupNode(node: GroupNode, root: WorkspaceRoot): StoredGroupNode {
  if (node.kind === 'group')
    return {
      ...node,
      tabs: node.tabs.flatMap((tab) => {
        const content = encodeTabContent(tab.content, root)
        return content === null ? [] : [{ id: tab.id, content }]
      }),
    }
  const convert = (child: (typeof node.children)[number]) => ({
    size: child.size,
    node: storedGroupNode(child.node, root),
  })
  const [first, second, ...rest] = node.children
  return { ...node, children: [convert(first), convert(second), ...rest.map(convert)] }
}

function restoredGroupNode(node: StoredGroupNode, root: WorkspaceRoot): GroupNode {
  if (node.kind === 'group')
    return {
      ...node,
      tabs: node.tabs.flatMap((tab) => {
        const content = decodeTabContent(tab.content, root)
        return content === null ? [] : [{ id: tab.id, content }]
      }),
    }
  const convert = (child: (typeof node.children)[number]) => ({
    size: child.size,
    node: restoredGroupNode(child.node, root),
  })
  const [first, second, ...rest] = node.children
  return { ...node, children: [convert(first), convert(second), ...rest.map(convert)] }
}

function storedContents(root: WorkspaceRoot, contents: readonly TabContent[]): StoredTabContent[] {
  return uniqueContents(contents).flatMap((content) => {
    const encoded = encodeTabContent(content, root)
    return encoded === null ? [] : [encoded]
  })
}

function restoredContents(
  root: WorkspaceRoot,
  contents: readonly StoredTabContent[],
): TabContent[] {
  return uniqueContents(
    contents.flatMap((content) => {
      const decoded = decodeTabContent(content, root)
      return decoded === null ? [] : [decoded]
    }),
  )
}

function uniqueContents(contents: readonly TabContent[]): TabContent[] {
  return Array.from(new Map(contents.map((content) => [tabContentKey(content), content])).values())
}

/**
 * Bumping `CACHE_VERSION` renames the index too, and `writeWorkspaceIndexCache` — the
 * only deleter of per-root storage — walks the CURRENT version's index. So every
 * superseded `…v<n>.workspace:<root>` and `…v<n>.search:<root>` key becomes unreachable
 * and undeletable. Search buffers carry a materialized match list, so that is real
 * quota, not a few bytes. Sweeping them is garbage collection of keys nothing can
 * reach, not a migration: no value is read, translated or preserved.
 */
function purgeSupersededCacheVersions(storage: ScopedStorage) {
  const superseded = supersededCacheKeys(storage)
  if (superseded.length === 0) return

  for (const key of superseded) removeCacheEntry(key, storage)

  log.info({
    action: 'workspace.cache_versions_purged',
    area: 'workspace',
    keys: superseded.length,
    version: CACHE_VERSION,
  })
}

function supersededCacheKeys(storage: ScopedStorage) {
  const keys: string[] = []

  try {
    for (const key of storage.keys(CACHE_KEY_NAMESPACE)) {
      if (!key.startsWith(CACHE_KEY_NAMESPACE)) continue
      if (key.startsWith(`${CACHE_KEY_PREFIX}.`)) continue

      keys.push(key)
    }
  } catch {
    return []
  }

  return keys
}

export function emptyWorkspaceSlice(): CachedWorkspaceSlice {
  return {
    editorHistory: [],
    recentlyClosedTabs: [],
    reopenScrollPositions: [],
    viewScrollPositions: [],
    workbenchPanels: createDefaultWorkbenchPanels(),
  }
}

export function emptyWorkspaceState(): CachedWorkspaceState {
  return {
    worktreeIdByRootPath: {},
    chatModePanels: createDefaultChatModePanels(),
    rootFolder: null,
    searchBuffers: {},
    uiMode: DEFAULT_WORKSPACE_UI_MODE,
    workbenchLayout: createDefaultWorkbenchLayout(),
    workspaceOrder: [],
    workspaces: {},
  }
}

function searchBufferFits(buffer: CachedSearchBufferState): boolean {
  let remaining = SEARCH_RELOAD_MAX_BYTES / 2
  const pending: unknown[] = [buffer]
  let nodes = 20_000
  while (pending.length) {
    if (--nodes < 0) return false
    const value = pending.pop()
    // Bound capture work here; the writer measures actual escaped JSON bytes.
    if (typeof value === 'string') remaining -= value.length
    if (remaining < 0) return false
    if (!value || typeof value !== 'object') continue
    const count = Array.isArray(value) ? value.length : Object.keys(value).length
    if (count > nodes) return false
    pending.push(...Object.values(value))
  }
  return true
}
