import { quickAccessMode } from '@workspace/client-core/commands/palette'
export {
  groupedCommandItems,
  quickAccessMode,
  quickAccessQuery,
  quickAccessFilter,
  scopedPaletteFilter,
  RECENTLY_USED_COMMANDS_HEADING,
  OTHER_COMMANDS_HEADING,
} from '@workspace/client-core/commands/palette'
import { searchMatchEntry } from '@/lib/search-match-entry'
import { comparisonDisplayPath, tabPalettePresentation } from '@/lib/documents/utils/labels'
import { sameTabContent, tabContentKey } from '@/lib/documents/utils/tabs'
import type { TabContent } from '@/lib/documents/utils/types'
import { commandShortcut } from '@/keymap/utils/format-keys'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { isFileEntry } from '@/lib/file-system-types'
import type { CommandInvocation, CommandOutcome } from '@/keymap/state/command-bus'
import type {
  FocusDestination,
  FocusTargetToken,
  FocusTransitionOutcome,
} from '@/lib/focus/state/service'
import { matchesActiveSurface } from '@/lib/focus/utils/active-surface'
import type { LoadState } from '@/lib/load-state'
import { toTreePath } from '@/lib/path-formatters'
import type { TreeModel } from '@/lib/tree-model'
import type { CommandSpec } from '@/keymap/command-registry'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'

import {
  colorModePaletteItems,
  hiddenCommandPaletteCommands,
  paletteModeCommands,
} from '@/features/command-palette/utils/data'
import type {
  ColorModePaletteItem,
  CommandPaletteItem,
  EditorPaletteItem,
  FilePaletteItem,
  QuickAccessMode,
  QuickOpenFileMatch,
} from '@/features/command-palette/utils/types'

/** Chat sessions have no path and no file icon, so they need a prefix of their own. */

export function commandPaletteItems(
  specs: readonly CommandSpec[],
  bindings: readonly PlatformKeyBinding[],
): readonly CommandPaletteItem[] {
  return specs
    .filter((spec) => !hiddenCommandPaletteCommands.has(spec.id))
    .map((spec) => platformCommandPaletteItem(spec, bindings))
}

type Inspected = { readonly status: string; readonly reason?: string }

export function disabledReasonOf(inspection: Inspected) {
  return inspection.status === 'disabled' ? (inspection.reason ?? null) : null
}

/** One inspection per command: it decides visibility and carries the disabled reason as data. */
export function inspectedCommandItems<Inspection extends Inspected>(
  items: readonly CommandPaletteItem[],
  inspect: (item: CommandPaletteItem) => Inspection,
  visible: (item: CommandPaletteItem, inspection: Inspection) => boolean,
): readonly CommandPaletteItem[] {
  return items.flatMap((item) => {
    const inspection = inspect(item)
    if (!visible(item, inspection)) return []
    return [{ ...item, disabledReason: disabledReasonOf(inspection) }]
  })
}

export function filePaletteItems(state: LoadState<TreeModel>): readonly FilePaletteItem[] {
  if (state.status !== 'ready') return []

  return state.data.paths.flatMap((treePath) => {
    const entry = state.data.entriesByTreePath.get(treePath.replace(/\/$/, ''))
    if (!entry || !isFileEntry(entry)) return []

    return [{ entry, pathLabel: treePath }]
  })
}

export function searchFilePaletteItems(
  matches: readonly QuickOpenFileMatch[],
  rootPath: string,
): readonly FilePaletteItem[] {
  return matches.map((match) => ({
    entry: searchMatchEntry(match),
    pathLabel: toTreePath(match.path, rootPath),
  }))
}

export function selectedFileCommandValue(
  selectedValue: string | null,
  items: readonly FilePaletteItem[],
) {
  const firstValue = items[0] ? fileItemValue(items[0]) : undefined
  if (!selectedValue) return firstValue
  if (items.some((item) => fileItemValue(item) === selectedValue)) return selectedValue

  return firstValue
}

export function fileItemValue(item: FilePaletteItem) {
  return `file:${item.entry.path}`
}

/** The file row cmdk has highlighted, which the preview follows. */
export function highlightedFileItem(items: readonly FilePaletteItem[], value: string | undefined) {
  return items.find((item) => fileItemValue(item) === value) ?? null
}

export function editorPaletteItems(
  contents: readonly TabContent[],
  selected: TabContent | null,
): readonly EditorPaletteItem[] {
  return contents.map((content) => ({
    active: selected !== null && sameTabContent(content, selected),
    content,
    key: tabContentKey(content),
    ...tabPalettePresentation(content),
  }))
}

function commandKeywords(spec: CommandSpec) {
  return [
    spec.title,
    spec.category,
    spec.description ?? '',
    spec.id,
    ...(spec.aliases ?? []),
    ...(spec.vscodeCommandIds ?? []),
  ]
}

export function isColorPreviewMode(mode: QuickAccessMode): boolean {
  return (
    mode === 'colorMode' ||
    mode === 'colorTheme' ||
    mode === 'appColors' ||
    mode === 'themeBundle' ||
    mode === 'wallpaper'
  )
}

/**
 * Modes whose rows arrive already filtered and already ordered — commands by recency
 * then match, files by the search server's own rank.
 *
 * cmdk re-sorts the rendered list by its own match score whenever it filters, and it
 * re-sorts groups by their best-scoring row. For these two that is not a second opinion
 * but a silent override: it would drop a just-used command back below a better textual
 * match, which is the whole thing recency exists to prevent.
 */
export function paletteOwnsItemOrder(mode: QuickAccessMode) {
  return mode === 'commands' || mode === 'files'
}

/** The same ranking, for a scope whose input holds the bare query and no prefix. */

/**
 * The mode a command-opened prefix pushes the palette into, or `null` for the two
 * root modes, whose prefix belongs in the input because the user types it there.
 *
 * A sub-picker holds its mode outside the input instead: leaving `theme ` in the box
 * meant the first Backspace turned it into `theme`, which is no prefix at all, and the
 * picker vanished mid-word.
 */
export function paletteScopeForPrefix(prefix: string): QuickAccessMode | null {
  const mode = quickAccessMode(prefix)
  if (mode === 'commands' || mode === 'files') return null

  return mode
}

export function scopeLabelForMode(mode: QuickAccessMode) {
  if (mode === 'appColors') return 'App colors'
  if (mode === 'themeBundle') return 'Theme'
  if (mode === 'wallpaper') return 'Wallpaper'
  if (mode === 'views') return 'View'
  if (mode === 'colorMode') return 'Light / dark mode'
  if (mode === 'colorTheme') return 'Code theme'
  if (mode === 'editors') return 'Open Editor'
  if (mode === 'scripts') return 'Script'
  if (mode === 'sessions') return 'Session'
  if (mode === 'symbols') return 'Go to Symbol'
  if (mode === 'gotoLine') return 'Go to Line'

  return 'Commands'
}

export function emptyLabelForMode(mode: QuickAccessMode) {
  if (mode === 'appColors') return 'No matching app colors'
  if (mode === 'themeBundle') return 'No matching themes'
  if (mode === 'wallpaper') return 'No matching wallpapers'
  if (mode === 'commands') return 'No matching commands'
  if (mode === 'views') return 'No matching views'
  if (mode === 'colorMode') return 'No matching light / dark modes'
  if (mode === 'colorTheme') return 'No matching code themes'
  if (mode === 'editors') return 'No open editors'
  if (mode === 'sessions') return 'No matching sessions'
  if (mode === 'symbols') return 'No matching symbols'

  return 'No matching files'
}

export function placeholderForMode(mode: QuickAccessMode) {
  if (mode === 'appColors') return 'Select app colors (up/down keys to preview)…'
  if (mode === 'themeBundle') return 'Select a theme (up/down keys to preview)…'
  if (mode === 'wallpaper') return 'Select a wallpaper (up/down keys to preview)…'
  if (mode === 'commands') return 'Search commands…'
  if (mode === 'views') return 'Search views…'
  // Both preview live on the highlighted row, so say what the arrow keys do.
  if (mode === 'colorMode') return 'Select light or dark mode (up/down keys to preview)…'
  if (mode === 'colorTheme') return 'Select a code theme (up/down keys to preview)…'
  if (mode === 'editors') return 'Search open editors…'
  if (mode === 'scripts') return 'Search project scripts…'
  if (mode === 'sessions') return 'Search sessions, or start one in a project…'
  if (mode === 'symbols') return 'Search symbols in the active editor…'
  if (mode === 'gotoLine') return 'Go to line and column…'

  return 'Search files, > for commands, sess for sessions…'
}

/**
 * Title first, project second — `quickAccessRankTarget` reads those two slots as the
 * label and the path, which is what makes "footer" beat a project called "footers".
 */
export function sessionPaletteKeywords(session: {
  readonly branch: string | null
  readonly projectTitle: string
  readonly title: string
}) {
  return [session.title, session.projectTitle, session.branch ?? '']
}

/** What the row cannot show: where the session lives and on which machine. */
export function sessionRowTitle(session: {
  readonly branch: string | null
  readonly machineLabel: string | null
  readonly projectTitle: string
  readonly title: string
  readonly worktreePath: string
}) {
  const where = session.branch
    ? `${session.projectTitle} › ${session.branch} (${session.worktreePath})`
    : `${session.projectTitle} (${session.worktreePath})`
  const machine = session.machineLabel ? ` on ${session.machineLabel}` : ''

  return `${session.title} — ${where}${machine}`
}

export function sessionProjectRowTitle(project: {
  readonly qualifier: string | null
  readonly workspaceRoot: string
}) {
  if (!project.qualifier) return project.workspaceRoot

  return `${project.workspaceRoot} (${project.qualifier})`
}

export function sessionItemValue(sessionId: string) {
  return `session:${sessionId}`
}

const COLOR_THEME_VALUE_PREFIX = 'color-theme:'

export function colorThemeItemValue(themeId: string) {
  return `${COLOR_THEME_VALUE_PREFIX}${themeId}`
}

/** The theme behind a highlighted palette row, or `null` if the row is not one. */
export function colorThemeIdFromItemValue(value: string): string | null {
  if (!value.startsWith(COLOR_THEME_VALUE_PREFIX)) return null

  return value.slice(COLOR_THEME_VALUE_PREFIX.length) || null
}

/** The color mode behind a highlighted palette row, or `null` if the row is not one. */
export function colorModeItemForValue(value: string): ColorModePaletteItem | null {
  return colorModePaletteItems.find((item) => item.value === value) ?? null
}

export function previewColorModeItem(
  value: string,
  preview: (mode: ColorModePaletteItem['mode']) => void,
) {
  const item = colorModeItemForValue(value)
  if (!item) return false

  preview(item.mode)
  return true
}

export function sessionProjectItemValue(projectId: string) {
  return `session-project:${projectId}`
}

export function commandKeepsPaletteOpen(command: PlatformCommandId) {
  return paletteModeCommands.has(command)
}

export function paletteCommandInvocation(origin: FocusTargetToken | null): CommandInvocation {
  return { origin, source: { kind: 'palette' } }
}

export function paletteCommandSucceeded(outcome: CommandOutcome) {
  return outcome.status === 'handled' || outcome.status === 'deferred'
}

export function focusTransitionAcknowledged(outcome: FocusTransitionOutcome) {
  return outcome.status === 'acknowledged'
}

export function activeEditorFocusDestination(
  workspace: EditorWorkspaceStoreApi,
): FocusDestination | null {
  const workspaceState = workspace.getState()
  const activeTab = activeEditorTabForWorkbenchPanels(workspaceState.workbenchPanels)
  if (!activeTab) return null
  const layout = workspaceState.uiMode

  const document = activeTab.content.kind === 'document' ? activeTab.content.document : null
  let diffPath: string | null = null
  if (document?.kind === 'compare-saved') diffPath = document.file.path
  if (document?.kind === 'git-diff') diffPath = comparisonDisplayPath(document.source)
  const searchRoot = document?.kind === 'search' ? document.root : null
  const identity = { diffPath, layout, searchRoot, tabId: activeTab.id } as const

  return {
    isValid: () => {
      const current = activeEditorTabForWorkbenchPanels(workspace.getState().workbenchPanels)
      return (
        workspace.getState().uiMode === layout &&
        current?.id === activeTab.id &&
        sameTabContent(current.content, activeTab.content)
      )
    },
    kind: 'match',
    matches: (target) => matchesActiveSurface(target, identity),
  }
}

/** The symbol's kind and container, for the row title; the row itself shows only the kind. */
export function symbolRowTitle(symbol: {
  readonly containerName: string | null
  readonly kind: number
  readonly name: string
}) {
  return `${symbol.name}: ${symbolDescription(symbol)}`
}

export function symbolDescription(symbol: { containerName: string | null; kind: number }) {
  const kind = symbolKindLabel(symbol.kind)
  if (!symbol.containerName) return kind

  return `${kind} in ${symbol.containerName}`
}

export function symbolKindLabel(kind: number) {
  if (kind === 5) return 'Class'
  if (kind === 6) return 'Method'
  if (kind === 7) return 'Property'
  if (kind === 10) return 'Enum'
  if (kind === 11) return 'Interface'
  if (kind === 12) return 'Function'
  if (kind === 13) return 'Variable'

  return 'Symbol'
}

function platformCommandPaletteItem(
  spec: CommandSpec,
  bindings: readonly PlatformKeyBinding[],
): CommandPaletteItem {
  return {
    aliases: spec.aliases ?? [],
    category: spec.category,
    command: { command: spec.id, kind: 'platform' },
    description: spec.description,
    id: spec.id,
    keywords: commandKeywords(spec),
    shortcut: commandShortcut(spec.id, bindings),
    title: spec.title,
  }
}
