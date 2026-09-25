import { CodeThemePreviewPanel } from '@/features/command-palette/components/code-theme-preview-panel'
import { FilePreviewPanel } from '@/features/command-palette/components/file-preview-panel'
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandList,
} from '@workspace/ui/components/command'
import { useEffect, useEffectEvent, useMemo, useRef, type KeyboardEvent } from 'react'

import { GroupsFactory } from '@/features/command-palette/components/groups-factory'
import { colorModePaletteItems, viewPaletteItems } from '@/features/command-palette/utils/data'
import {
  activeEditorFocusDestination,
  colorThemeIdFromItemValue,
  commandKeepsPaletteOpen,
  commandPaletteItems,
  disabledReasonOf,
  editorPaletteItems,
  emptyLabelForMode,
  focusTransitionAcknowledged,
  groupedCommandItems,
  inspectedCommandItems,
  isPreviewScope,
  PREVIEW_SCOPES,
  type PreviewScope,
  paletteCommandInvocation,
  paletteCommandSucceeded,
  paletteOwnsItemOrder,
  placeholderForMode,
  previewColorModeItem,
  quickAccessFilter,
  quickAccessMode,
  quickAccessQuery,
  scopeLabelForMode,
  scopedPaletteFilter,
  highlightedFileItem,
} from '@/features/command-palette/utils/query'
import { fileUriForPath } from '@/lib/file-uri'
import { ScopeChip } from '@/features/command-palette/components/scope-chip'
import { HighlightReporter } from '@/features/command-palette/components/highlight-reporter'
import { useRecentCommandIds } from '@/features/command-palette/hooks/use-recent-command-ids'
import { paletteIdFromItemValue } from '@/features/command-palette/utils/app-colors'
import { themeBundleFromItemValue } from '@/features/command-palette/utils/theme-bundles'
import { wallpaperSourceFromItemValue } from '@/features/command-palette/utils/wallpapers'
import { useWallpaperPreviewStore } from '@/lib/wallpapers/state/preview-store'
import { useBundles } from '@/lib/appearance/hooks/use-bundles'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { isCommandVisibleInPalette } from '@/keymap/utils/palette-visibility'
import {
  CommandPaletteActionsContext,
  type CommandPaletteActions,
} from '@/features/command-palette/providers/actions-context'
import { recordCommandUse } from '@/features/command-palette/state/recent-commands-store'
import { useFiles } from '@/features/command-palette/hooks/use-files'
import { useScripts } from '@/features/command-palette/hooks/use-scripts'
import { useSessions } from '@/features/command-palette/hooks/use-sessions'
import { useSymbols } from '@/features/command-palette/hooks/use-symbols'
import { useSaveProjectScript } from '@/features/chat-mode/hooks/use-save-project-script'
import { openSessionRow, startSessionDraft } from '@/features/chat-mode/state/session-commands'
import {
  clearEditorThemePreview,
  previewEditorTheme,
} from '@/features/editor/state/color-theme-store'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import {
  useEditorWorkspaceState,
  useEditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { useTerminalCommandInboxStore } from '@/features/terminal/state/command-inbox-store'
import { useWorkspaceTreeState } from '@/features/workspace/hooks/use-tree'
import { useCommand } from '@/keymap/hooks/use-command'
import { platformCommandSpecs } from '@/keymap/command-registry'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

export function CommandPaletteContent() {
  const {
    bindings,
    bus,
    closePalette,
    paletteOpen: open,
    paletteOrigin,
    paletteScope,
    paletteSearch: search,
    popPaletteScope,
    setPaletteOpen,
    setPaletteSearch,
  } = useCommand()
  const focus = useFocusService()
  const workspace = useEditorWorkspaceStoreApi()
  const { selectTheme } = useEditorColorTheme()
  const { clearThemePreview, previewTheme, resolvedTheme, theme } = useTheme()
  const { catalog, clearPalettePreview, previewPalette } = usePalette()
  const { catalog: bundles, clear: clearBundlePreview, preview: previewBundle } = useBundles()
  const previewWallpaper = useWallpaperPreviewStore((state) => state.preview)
  const clearWallpaperPreview = useWallpaperPreviewStore((state) => state.clear)
  const hasWorkspace = useEditorWorkspaceState((state) => Boolean(state.rootFolder))
  const rootFolder = useEditorWorkspaceState((state) => state.rootFolder)
  const openTabContents = useEditorWorkspaceState((state) => state.openTabContents)
  const selectedTabContent = useEditorWorkspaceState((state) => state.selectedTabContent)
  const { openDefinition, selectFile, selectContent } = useEditorCommands()
  // A scope holds the mode outside the input, so the input is the bare query.
  const mode = paletteScope?.mode ?? quickAccessMode(search)
  const query = paletteScope ? search : quickAccessQuery(search)
  const treeState = useWorkspaceTreeState(rootFolder)
  const editorItems = editorPaletteItems(openTabContents, selectedTabContent)
  const listRef = useRef<HTMLDivElement | null>(null)
  const {
    fileQuery,
    fileSearchQuery,
    fileSearchUnsettled,
    selectedCommandValue,
    setSelectedFileItemValue,
    visibleFileItems,
  } = useFiles({
    listRef,
    mode,
    open,
    query,
    rootPath: rootFolder?.path ?? null,
    treeState,
  })
  const { selectedFileBackedPath, symbolQuery, symbolsEnabled } = useSymbols({
    mode,
    rootPath: rootFolder?.path ?? null,
    selectedTabContent,
  })
  const { projects: sessionProjects, sessions: sessionItems } = useSessions()
  const queueTerminalCommand = useTerminalCommandInboxStore((state) => state.queueCommand)
  const saveProjectScript = useSaveProjectScript()
  const { isPending: scriptsPending, scripts: scriptItems } = useScripts({
    enabled: open && mode === 'scripts',
    rootPath: rootFolder?.path ?? null,
  })
  // One capture per render, and only in the modes that list commands: a capture reads the
  // whole workspace, and quick open would pay for it on every keystroke and discard it.
  const commandContext =
    mode === 'commands' || mode === 'views' || mode === 'colorMode'
      ? bus.capture(paletteCommandInvocation(paletteOrigin))
      : null
  const commandOrigin = paletteOrigin ? focus.getTarget(paletteOrigin) : null
  const commandItems =
    commandContext && mode === 'commands'
      ? inspectedCommandItems(
          commandPaletteItems(platformCommandSpecs, bindings),
          (item) => commandContext.inspect(item.command.command),
          (item, inspection) =>
            isCommandVisibleInPalette(item.command.command, inspection, commandOrigin),
        )
      : []
  const viewItems =
    commandContext && mode === 'views'
      ? viewPaletteItems.map((item) => ({
          ...item,
          disabledReason: disabledReasonOf(commandContext.inspect(item.command)),
        }))
      : []
  const colorModeItems =
    commandContext && mode === 'colorMode'
      ? colorModePaletteItems.map((item) => ({
          ...item,
          disabledReason: disabledReasonOf(commandContext.inspect(item.command)),
        }))
      : []
  const recentCommandIds = useRecentCommandIds()
  const groups = groupedCommandItems(commandItems, search, recentCommandIds)
  const { ref: paletteTargetRef } = useFocusTarget<HTMLDivElement>({
    area: 'command-palette',
    capabilities: { overlay: true },
    id: { kind: 'command-palette' },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false

      const input = element.querySelector<HTMLElement>('[data-slot="command-input"]')
      if (!input) return false

      input.focus()
      return true
    },
  })

  // Release only this palette’s previews when switching commands or closing.
  const previewed = useRef(new Set<PreviewScope>())
  const release = useEffectEvent((scope: PreviewScope) => {
    if (!previewed.current.delete(scope)) return
    if (scope === 'colorTheme') clearEditorThemePreview()
    if (scope === 'colorMode') clearThemePreview()
    if (scope === 'appColors') clearPalettePreview()
    if (scope === 'themeBundle') clearBundlePreview()
    if (scope === 'wallpaper') clearWallpaperPreview()
  })

  useEffect(() => {
    for (const scope of PREVIEW_SCOPES) if (scope !== mode) release(scope)
  }, [mode])

  useEffect(
    () => () => {
      for (const scope of PREVIEW_SCOPES) release(scope)
    },
    [],
  )

  function previewHighlightedColorTheme(value: string) {
    const themeId = colorThemeIdFromItemValue(value)
    if (!themeId) return

    previewEditorTheme(resolvedTheme, themeId)
  }

  function previewHighlightedColorMode(value: string) {
    previewColorModeItem(value, previewTheme)
  }

  function previewHighlighted(value: string) {
    if (isPreviewScope(mode)) previewed.current.add(mode)
    if (mode === 'wallpaper') {
      const source = wallpaperSourceFromItemValue(value)
      if (source) previewWallpaper(source)
      return
    }
    if (mode === 'themeBundle') {
      const bundle = themeBundleFromItemValue(bundles, value)
      if (bundle) previewBundle(bundle)
      return
    }
    if (mode === 'appColors') {
      const id = paletteIdFromItemValue(value)
      const palette = catalog.find((candidate) => candidate.id === id)
      if (palette) previewPalette(palette)
      return
    }
    if (mode === 'colorTheme') {
      previewHighlightedColorTheme(value)
      return
    }

    previewHighlightedColorMode(value)
  }

  function handleCommandValueChange(value: string) {
    if (mode !== 'files') return

    setSelectedFileItemValue(value)
  }

  function handleSearchChange(value: string) {
    if (!paletteScope && quickAccessMode(value) === 'files') setSelectedFileItemValue(null)

    setPaletteSearch(value)
  }

  // Backspace on an empty scoped input is the way back out of a sub-picker, which is
  // why entering one clears the input: there is no prefix left to delete instead.
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!paletteScope || event.key !== 'Backspace' || search.length > 0) return

    event.preventDefault()
    popPaletteScope()
  }

  // Context identity must stay stable while cmdk updates its controlled input.
  const actions = useMemo<CommandPaletteActions>(() => {
    async function focusSelectedEditor() {
      const destination = activeEditorFocusDestination(workspace)
      if (!destination) return false

      const outcome = await focus.request(destination).completion
      return focusTransitionAcknowledged(outcome)
    }

    async function revealDestination(
      command: 'workspace.revealTerminal' | 'workspace.showChatMode',
    ) {
      const ticket = bus.dispatch(command, paletteCommandInvocation(paletteOrigin))
      const outcome = await ticket.completion
      if (!paletteCommandSucceeded(outcome)) return false

      closePalette(false)
      return true
    }

    return {
      previewColorTheme: (themeId) => {
        previewEditorTheme(resolvedTheme, themeId)
      },
      selectColorTheme: (themeId) => {
        selectTheme(themeId, 'workspace.selectColorTheme')
        closePalette(true)
      },
      selectContent: async (content) => {
        if ((await selectContent(content)).status !== 'applied') return
        if (!(await focusSelectedEditor())) return

        closePalette(false)
      },
      selectFile: async (path) => {
        if ((await selectFile(path)).status !== 'applied') return
        if (!(await focusSelectedEditor())) return

        closePalette(false)
      },
      selectGotoLine: async (target) => {
        if (!selectedFileBackedPath) return

        const position = { character: target.column - 1, line: target.line - 1 }
        const handled = await openDefinition({
          path: selectedFileBackedPath,
          range: { end: position, start: position },
          uri: fileUriForPath(selectedFileBackedPath),
        })
        if (handled.status !== 'applied') return
        if (!(await focusSelectedEditor())) return

        closePalette(false)
      },
      selectPlatformCommand: async (command) => {
        const ticket = bus.dispatch(command, paletteCommandInvocation(paletteOrigin))
        const outcome = await ticket.completion
        if (!paletteCommandSucceeded(outcome)) return

        recordCommandUse(command)
        if (commandKeepsPaletteOpen(command)) return

        closePalette(true)
      },
      selectScript: async (script) => {
        saveProjectScript(script)
        queueTerminalCommand(script.command)
        await revealDestination('workspace.revealTerminal')
      },
      selectSession: async (session) => {
        if (!(await openSessionRow(session))) return
        await revealDestination('workspace.showChatMode')
      },
      selectSymbol: async (symbol) => {
        if (!selectedFileBackedPath) return

        const handled = await openDefinition({
          path: selectedFileBackedPath,
          range: symbol.selectionRange,
          uri: fileUriForPath(selectedFileBackedPath),
        })
        if (handled.status !== 'applied') return
        if (!(await focusSelectedEditor())) return

        closePalette(false)
      },
      startSessionDraft: async (ref) => {
        if (!(await startSessionDraft(ref))) return
        await revealDestination('workspace.showChatMode')
      },
    }
  }, [
    bus,
    closePalette,
    focus,
    openDefinition,
    paletteOrigin,
    queueTerminalCommand,
    resolvedTheme,
    saveProjectScript,
    selectFile,
    selectContent,
    selectTheme,
    selectedFileBackedPath,
    workspace,
  ])

  return (
    <CommandDialog
      title={mode === 'colorTheme' ? 'Choose code theme' : undefined}
      description={
        mode === 'colorTheme'
          ? 'Preview code themes with the arrow keys. Enter saves; Escape cancels.'
          : undefined
      }
      commandKey={mode}
      commandProps={{
        defaultValue: mode === 'colorMode' ? `color-mode:${theme}` : undefined,
        className: mode === 'colorTheme' ? 'max-h-[calc(100dvh-4rem)]' : undefined,
        filter: paletteScope ? scopedPaletteFilter : quickAccessFilter,
        loop: true,
        onValueChange: handleCommandValueChange,
        shouldFilter: !paletteOwnsItemOrder(mode),
        value: selectedCommandValue,
      }}
      contentRef={paletteTargetRef}
      finalFocus={false}
      onOpenChange={setPaletteOpen}
      open={open}
      overlayClassName={
        isPreviewScope(mode) ? 'supports-backdrop-filter:backdrop-blur-none' : undefined
      }
    >
      <CommandInput
        autoFocus
        placeholder={placeholderForMode(mode)}
        scope={paletteScope ? <ScopeChip label={scopeLabelForMode(paletteScope.mode)} /> : null}
        value={search}
        onKeyDown={handleSearchKeyDown}
        onValueChange={handleSearchChange}
      />
      <CommandList
        className={
          mode === 'colorTheme'
            ? 'max-h-60 min-h-0 shrink overflow-y-auto py-1'
            : 'max-h-[min(440px,calc(100vh-8rem))] overscroll-contain py-1'
        }
        ref={listRef}
      >
        {isPreviewScope(mode) && <HighlightReporter onHighlight={previewHighlighted} />}
        {!fileSearchUnsettled && <CommandEmpty>{emptyLabelForMode(mode)}</CommandEmpty>}
        <CommandPaletteActionsContext value={actions}>
          <GroupsFactory
            colorModeItems={colorModeItems}
            commandGroups={groups}
            currentTheme={theme}
            editorItems={editorItems}
            fileItems={visibleFileItems}
            fileQuery={fileQuery}
            fileSearchError={fileSearchQuery.isError}
            hasWorkspace={hasWorkspace}
            mode={mode}
            scriptItems={scriptItems}
            scriptsPending={scriptsPending}
            sessionItems={sessionItems}
            sessionProjects={sessionProjects}
            symbolItems={symbolQuery.data ?? []}
            symbolsPending={symbolsEnabled && symbolQuery.isPending}
            viewItems={viewItems}
          />
        </CommandPaletteActionsContext>
      </CommandList>
      {mode === 'colorTheme' && <CodeThemePreviewPanel query={query} />}
      {mode === 'files' ? (
        <FilePreviewPanel item={highlightedFileItem(visibleFileItems, selectedCommandValue)} />
      ) : null}
    </CommandDialog>
  )
}
