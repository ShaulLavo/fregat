import { WORKSPACE_CACHE_STORAGE_KEYS } from '@/features/workspace/state/cache'

/**
 * Which state is a place, which is a preference, and which must never be replayed.
 *
 * Encoded as data rather than prose so a test can fail when a new persisted key
 * appears unclassified. That is the guard against the one drift this design cannot
 * otherwise catch: a new code path that persists something and never tells the
 * address layer it exists.
 */

export type StateClassification =
  /** Names where you are. Goes in the URL. */
  | 'address'
  /** How you like things drawn. Stays in localStorage; a link must never change it. */
  | 'preference'
  /** Must never be replayed from a URL, and several must never be durable at all. */
  | 'ephemeral'

export type ClassifiedState = {
  readonly classification: StateClassification
  /** The localStorage key, where one exists. In-memory stores have none. */
  readonly storageKey?: string
  readonly why: string
}

/**
 * Read from the cache's own key map rather than retyped.
 *
 * These keys carry `CACHE_VERSION` in them, and the drift test cannot catch a stale
 * copy: the real keys are built by template interpolation, so `persistedKeysInSource`
 * never sees them as literals, and `classifiedStorageKeys()` is only ever used as a
 * filter. Six hand-written `…v17.…` strings would therefore have gone silently wrong at
 * the next version bump — in a table whose entire purpose is to notice drift.
 */
const CACHE_KEYS = WORKSPACE_CACHE_STORAGE_KEYS

export const STATE_CLASSIFICATIONS: Readonly<Record<string, ClassifiedState>> = {
  address: {
    classification: 'address',
    storageKey: 'platform.address.v2',
    why: 'the address itself — the restore payload half of the dual serialization',
  },
  connectedMachines: {
    classification: 'preference',
    storageKey: 'platform.environments.connected.v1',
    why: 'remembered machine connections are browser preferences, not link destinations',
  },
  chatInputDrafts: {
    classification: 'ephemeral',
    storageKey: 'platform.chat-input-drafts.v1',
    why: 'unsent text is the archetypal non-linkable state',
  },
  chatModePanels: {
    classification: 'preference',
    storageKey: CACHE_KEYS.chatModePanels,
    why: 'fused: activeToolTab is address (?tool=), sessionRailOpen/toolPaneOpen are chrome',
  },
  chatModeSelection: {
    classification: 'address',
    storageKey: CACHE_KEYS.chatModeSelection,
    why: 't/<id> | t/new | absent — key retired once the address restores it',
  },
  navigationPending: {
    classification: 'ephemeral',
    storageKey: 'platform.navigation.pending',
    why: 'a take-once inbox for the navigation a reload interrupted; replaying it from a link would loop',
  },
  paletteBoot: {
    classification: 'preference',
    storageKey: 'platform.palette-boot.v1',
    why: 'the palette CSS cached for first paint, derived from the palette preference',
  },
  environmentBinding: {
    classification: 'preference',
    storageKey: 'platform.environments.binding.v1',
    why: 'which machine an environment id belongs to, so a cold boot can resolve it before connecting',
  },
  chatRailCollapse: {
    classification: 'preference',
    storageKey: 'platform.chat-rail-collapse.v1',
    why: 'tidying',
  },
  chatSessionReads: {
    classification: 'preference',
    storageKey: 'platform.chat-session-reads.v1',
    why: '"have I read this" is a property of this browser',
  },
  changedFilesExpansion: {
    classification: 'preference',
    storageKey: 'platform.chat-changed-files-expansion.v1',
    why: 'tidying',
  },
  commandPaletteOpen: {
    classification: 'ephemeral',
    why: 'an open menu is never a place; a finder’s result is the address',
  },
  commandPaletteRecents: {
    classification: 'preference',
    storageKey: 'platform.command-palette.recent-commands.v1',
    why: 'an MRU of commands you ran, not a place you can be',
  },
  composerInbox: {
    classification: 'ephemeral',
    why: 'take-once queue; a replayed URL would inject prompt text on load',
  },
  conflictDocuments: {
    classification: 'ephemeral',
    why: 'born from a watcher event, holds its text in memory, cannot survive a reload',
  },
  definitionTarget: {
    classification: 'address',
    why: '#L… — the intra-document position',
  },
  editorColorTheme: {
    classification: 'preference',
    why: 'code appearance saved in settings',
  },
  editorHistory: {
    classification: 'preference',
    why: 'MRU stack, not a place',
  },
  gitCommitMessage: {
    classification: 'ephemeral',
    why: 'a draft, and live commit output is a stream',
  },
  logsFilter: {
    classification: 'address',
    why: 'log.* — the filter itself lives in the URL, never in storage',
  },
  logsView: {
    classification: 'preference',
    storageKey: 'logs.view.v1',
    why: 'scroll offset, the viewed time window and the expanded row; no log events',
  },
  promptStash: {
    classification: 'ephemeral',
    storageKey: 'platform.prompt-stash.v1',
    why: 'unsent text; the colon-namespaced key was renamed to the dotted convention',
  },
  railScope: {
    classification: 'ephemeral',
    why: 'a ProjectId — a one-way hash of an absolute path — so it cannot go in a URL at all',
  },
  railView: {
    classification: 'address',
    why: '?rail=archived — a moment, not a preference',
  },
  resizableLayoutChatMode: {
    classification: 'preference',
    storageKey: 'platform.resizable-layout.chat-mode',
    why: 'geometry; a link must never resize your window',
  },
  rootFolder: {
    classification: 'address',
    storageKey: CACHE_KEYS.rootFolder,
    why: '~name.id; the server owns folder identity and keeps the absolute path private',
  },
  scrollPositions: {
    classification: 'preference',
    why: 'remembered position ≠ addressed position',
  },
  searchBuffer: {
    classification: 'preference',
    why: 'fused: query and flags are address (s.*), histories and matches are not',
  },
  searchReplaceText: {
    classification: 'ephemeral',
    why: 'a link that prefills a bulk-replace field is one click from data loss',
  },
  sessionDeleteRequest: {
    classification: 'ephemeral',
    why: 'a link must never open a delete dialog',
  },
  sessionIsolation: {
    classification: 'ephemeral',
    why: 'arms the next send to create a worktree; must not survive a back press',
  },
  sessionMultiSelect: {
    classification: 'ephemeral',
    why: 'would arm a destructive action the user no longer remembers making',
  },
  settingsBootMirror: {
    classification: 'preference',
    storageKey: 'platform.settings-boot-mirror.v1',
    why: 'the settings snapshot read before the first query lands',
  },
  settingsCategory: {
    classification: 'address',
    why: '?settings= selects a category on the settings page',
  },
  terminalCommandInbox: {
    classification: 'ephemeral',
    why: 'take-once queue; a replayed URL would run a shell command on load',
  },
  sessionDiffScope: {
    classification: 'address',
    storageKey: 'platform.chat-session-diff-scope.v1',
    why: '?diff=wt | ?diff=turn-<id>',
  },
  uiMode: {
    classification: 'address',
    storageKey: CACHE_KEYS.uiMode,
    why: 'path segment 2 — key retired once the address restores it',
  },
  workbenchBottomTab: {
    classification: 'address',
    why: '?bottom=',
  },
  workbenchEditorTabs: {
    classification: 'address',
    why: '?tabs= when present; otherwise deferred to the remembered slice',
  },
  workbenchLayout: {
    classification: 'preference',
    storageKey: CACHE_KEYS.workbenchLayout,
    why: 'pane geometry is global; a link must never resize your window',
  },
  workbenchSidebarTab: {
    classification: 'address',
    why: '?side=',
  },
  workspaceIndex: {
    classification: 'preference',
    storageKey: CACHE_KEYS.workspaceIndex,
    why: 'recent workspace order; URL identity comes from the server',
  },
}

/** Every storage key the table accounts for, for the drift test. */
export function classifiedStorageKeys() {
  return new Set(
    Object.values(STATE_CLASSIFICATIONS).flatMap((entry) =>
      entry.storageKey ? [entry.storageKey] : [],
    ),
  )
}

export function statesClassifiedAs(classification: StateClassification) {
  return Object.entries(STATE_CLASSIFICATIONS)
    .filter(([, entry]) => entry.classification === classification)
    .map(([name]) => name)
}
