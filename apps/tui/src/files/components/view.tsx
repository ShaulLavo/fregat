import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import { isDirectoryEntry } from '@workspace/contracts'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { KeyValueStorage } from '@workspace/client-core/storage'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import { absolutePickerPath } from '@workspace/client-core/files/path-input'

import { useCommands } from '@/commands/hooks/use-commands'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import type { SettingsSession } from '@/connection/state/session'
import { connectionFailure } from '@/connection/utils/failure'
import { FilePreview } from '@/files/components/preview'
import { createFileBrowser } from '@/files/state/browser'
import { nextPickerFocus, type PickerFocus, type FileLocation } from '@/files/utils/list'
import {
  filePlaces,
  fileViewOptions,
  fileViewHint,
  initialFileSelection,
  type FilePlace,
} from '@/files/utils/view'
import type { Theme } from '@/theme/utils/theme'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { commandShortcut } from '@/commands/utils/bindings'

export function FileView({
  session,
  storage,
  owner,
  theme,
  onBack,
  initialPath,
  initialQuery = '',
  onLocationChange,
  onQueryChange,
  onOpenWorkbench,
  onOpenFile,
  places: projects = [],
  enabled = true,
}: {
  readonly session: SettingsSession
  readonly storage: KeyValueStorage
  readonly owner: SettingsOwner
  readonly theme: Theme
  readonly onBack: () => boolean
  readonly initialPath?: string
  readonly initialQuery?: string
  readonly onLocationChange?: (location: FileLocation & { readonly query: string }) => void
  readonly onQueryChange?: (query: string) => void
  readonly onOpenWorkbench?: (path: string) => Promise<void>
  readonly onOpenFile?: (path: string) => void
  readonly places?: readonly FilePlace[]
  readonly enabled?: boolean
}) {
  const [browser] = useState(() => createFileBrowser(session.client, storage))
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot)
  const lastReportedPath = useRef<string | null>(null)
  const [filter, setFilter] = useState({ initialQuery, value: initialQuery })
  if (filter.initialQuery !== initialQuery) setFilter({ initialQuery, value: initialQuery })
  const query = filter.initialQuery === initialQuery ? filter.value : initialQuery
  const setQuery = (value: string) => setFilter({ initialQuery, value })
  const [pathDraft, setPathDraft] = useState<{ directory: string; value: string } | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [selection, setSelection] = useState<{ directory: string; index: number } | null>(null)
  const latestSelection = useRef(selection)
  const directory = absolutePickerPath(state.path, state.paths?.workspaceRoot ?? '')
  const pathInput = pathDraft?.directory === directory ? pathDraft.value : directory
  const setSelected = (index: number) => {
    // Enter can arrive before React commits the native list's arrow selection.
    latestSelection.current = { directory, index }
    setSelection(latestSelection.current)
  }
  const commands = useCommands()
  const registry = commands.focus
  const focusState = useSyncExternalStore(registry.subscribe, registry.getSnapshot)
  const target = focusState.current?.capabilities.overlay
    ? focusState.lastCommandTarget
    : (focusState.requested?.target ?? focusState.current)
  let focus: PickerFocus = 'filter'
  if (target?.widgetId === 'file-picker-path') focus = 'path'
  if (target?.widgetId === 'file-picker-places') focus = 'places'
  const filterFocused = usePaneFocus({
    id: 'file-picker-filter',
    area: 'file-tree',
    textEntry: true,
    enabled,
  })
  const pathFocused = usePaneFocus({
    id: 'file-picker-path',
    area: 'file-tree',
    textEntry: true,
    enabled,
  })
  const placesFocused = usePaneFocus({ id: 'file-picker-places', area: 'file-tree', enabled })
  const { height, width } = useTerminalDimensions()
  const wide = width >= 90
  const compact = height < 20
  const showPlaces = !wide && focus === 'places'
  const showPreview = !wide && !showPlaces && state.preview.kind !== 'empty'
  const showFiles = !showPlaces && !showPreview
  const showHidden = useSettingValue(owner, 'files.showHidden')
  const notifyLocation = useEffectEvent((location: FileLocation) =>
    onLocationChange?.({ ...location, query }),
  )
  useEffect(() => {
    if (!state.location) return
    lastReportedPath.current = state.location.path
    notifyLocation(state.location)
  }, [state.location])
  useEffect(() => {
    const timer = setTimeout(
      () =>
        registry.request({
          kind: 'match',
          matches: (item) => item.widgetId === 'file-picker-filter',
        }),
      0,
    )
    return () => clearTimeout(timer)
  }, [registry])
  useEffect(() => {
    const reportedPath = lastReportedPath.current
    lastReportedPath.current = null
    if (initialPath === reportedPath) return
    void browser.open(initialPath)
  }, [browser, initialPath])
  useEffect(() => () => browser.dispose(), [browser])
  function setFocus(next: PickerFocus) {
    registry.request({ kind: 'match', matches: (item) => item.widgetId === `file-picker-${next}` })
  }
  function goUp() {
    setQuery('')
    setInputError(null)
    void browser.goUp()
  }
  function dismiss() {
    if (state.preview.kind === 'loading' || state.preview.kind === 'failed') {
      browser.clearPreview()
      return
    }
    if (!onBack() && state.preview.kind === 'ready') browser.clearPreview()
  }
  async function completePath() {
    try {
      const completed = await browser.completePath(pathInput)
      setPathDraft((current) => {
        const value = current?.directory === directory ? current.value : directory
        return value === pathInput ? { directory, value: completed } : current
      })
    } catch (error) {
      setInputError(connectionFailure(error).message)
    }
  }
  useKeyboard((event) => {
    if (event.defaultPrevented || !enabled || registry.getSnapshot().current?.capabilities.overlay)
      return
    if (event.name !== 'backspace' || !filterFocused || query || state.parentPath === null) return
    event.preventDefault()
    goUp()
  })
  useCommandHandlers(
    {
      'workspace.dismiss': { run: dismiss },
      'workspace.focusNextPane': {
        run: () => {
          if (focus === 'path') return completePath()
          setFocus(nextPickerFocus(focus))
        },
      },
      'workspace.focusPreviousPane': { run: () => setFocus(nextPickerFocus(focus, -1)) },
    },
    enabled,
  )
  useCommandHandlers(
    {
      'workspace.openWorkbench': {
        disabledReason: () =>
          state.listing.kind === 'ready' ? null : 'Wait for the folder to load.',
        run: openFolder,
      },
    },
    enabled && Boolean(onOpenWorkbench),
  )
  const entries = state.listing.kind === 'ready' ? state.listing.entries : []
  const options = fileViewOptions(entries, query, showHidden, state.parentPath)
  const selected =
    selection?.directory === directory ? selection.index : initialFileSelection(options)
  const places = filePlaces(state.paths, projects)
  function select(index: number, filter = query) {
    const rows =
      filter === query ? options : fileViewOptions(entries, filter, showHidden, state.parentPath)
    const choice = rows[index]?.value
    if (!choice) return
    if (choice.kind === 'parent') {
      goUp()
      return
    }
    const entry = choice.entry
    if (!isDirectoryEntry(entry) && onOpenFile) {
      onOpenFile(entry.path)
      return
    }
    if (isDirectoryEntry(entry)) setQuery('')
    void browser.select(entry)
  }
  function enterPath(input: string) {
    const failure = browser.enterPath(input)
    setInputError(failure)
    if (!failure) setQuery('')
  }
  async function openFolder() {
    if (!enabled || state.listing.kind !== 'ready' || !onOpenWorkbench) return
    try {
      await onOpenWorkbench(state.path)
    } catch (error) {
      const failure = connectionFailure(error)
      setInputError(failure.message)
      session.record({ action: 'tui.files.open-workbench.failed', path: state.path, ...failure })
    }
  }
  const dismissKeys = commandShortcut(commands.bindings, 'workspace.dismiss').replaceAll(
    'Escape',
    'Esc',
  )
  return (
    <box
      id='file-view'
      flexDirection='column'
      flexGrow={1}
      minHeight={0}
      paddingX={1}
      paddingBottom={compact ? 0 : 1}
      backgroundColor={theme.background}
    >
      <box flexDirection='column' flexShrink={0} backgroundColor={theme.card} paddingX={1}>
        <box flexDirection='row' justifyContent='space-between' height={1}>
          <text fg={theme.foreground}>
            <strong>Files</strong>
          </text>
          <box flexDirection='row' gap={2}>
            {!wide && (
              <text
                fg={theme.primary}
                onMouseDown={() => {
                  if (enabled) setFocus('places')
                }}
              >
                Places
              </text>
            )}
            <text
              fg={state.parentPath === null ? theme.mutedForeground : theme.primary}
              onMouseDown={() => {
                if (enabled && state.parentPath !== null) goUp()
              }}
            >
              {wide ? '↑ Parent folder' : '↑ Up'}
            </text>
            {onOpenWorkbench && (
              <text
                fg={theme.primary}
                onMouseDown={() => {
                  void openFolder()
                }}
              >
                {wide ? 'Open folder' : 'Open'}
              </text>
            )}
          </box>
        </box>
        <box flexDirection='row' height={1}>
          <text width={7} fg={pathFocused ? theme.primary : theme.mutedForeground}>
            Path
          </text>
          <box flexGrow={1} minWidth={0}>
            <Prompt
              id='file-picker-path'
              value={pathInput}
              onChange={(value) => {
                setPathDraft({ directory, value })
                setInputError(null)
              }}
              onSubmit={enterPath}
              focused={pathFocused}
              theme={theme}
              placeholder='Folder path…'
            />
          </box>
        </box>
        <box flexDirection='row' height={1}>
          <text width={7} fg={filterFocused ? theme.primary : theme.mutedForeground}>
            Filter
          </text>
          <box flexGrow={1} minWidth={0}>
            <Prompt
              id='file-picker-filter'
              value={query}
              onChange={(value) => {
                setQuery(value)
                onQueryChange?.(value)
                setSelected(
                  initialFileSelection(
                    fileViewOptions(entries, value, showHidden, state.parentPath),
                  ),
                )
                browser.clearPreview()
              }}
              onSubmit={(value) => {
                const current = latestSelection.current
                let index = selected
                if (value !== query)
                  index = initialFileSelection(
                    fileViewOptions(entries, value, showHidden, state.parentPath),
                  )
                if (value === query && current?.directory === directory) index = current.index
                select(index, value)
              }}
              focused={filterFocused}
              theme={theme}
              placeholder='Filter files…'
            />
          </box>
        </box>
      </box>
      {inputError && (
        <text fg={theme.destructive} flexShrink={0}>
          {inputError}
        </text>
      )}
      <box
        flexDirection='row'
        gap={1}
        marginTop={compact ? 0 : 1}
        flexGrow={1}
        minHeight={0}
        overflow='hidden'
      >
        {(wide || showPlaces) && (
          <box
            flexDirection='column'
            width={wide ? 22 : '100%'}
            flexShrink={0}
            minHeight={0}
            backgroundColor={theme.card}
            paddingX={1}
          >
            <text fg={theme.mutedForeground} height={1}>
              Places
            </text>
            <Select
              id='file-picker-places'
              showSelectionIndicator={placesFocused}
              options={places}
              focused={placesFocused}
              flexGrow={1}
              minHeight={0}
              onSelect={(index) => {
                const place = places[index]
                if (!place) return
                enterPath(place.value)
                setFocus('filter')
              }}
              showDescription={false}
              backgroundColor={theme.card}
              textColor={theme.foreground}
              selectedTextColor={theme.foreground}
              selectedBackgroundColor={placesFocused ? theme.accent : theme.card}
            />
          </box>
        )}
        {(wide || showFiles) && (
          <box
            flexDirection='column'
            flexGrow={1}
            flexBasis={0}
            minWidth={0}
            minHeight={0}
            backgroundColor={theme.card}
            paddingX={1}
          >
            {state.listing.kind === 'loading' && (
              <LoadingState theme={theme} label='Reading folder…' />
            )}
            {state.listing.kind === 'failed' && (
              <text fg={theme.destructive}>{state.listing.message}</text>
            )}
            {state.listing.kind === 'ready' && options.length === 0 && (
              <EmptyState
                title='No matching files'
                description='Try another folder or a shorter filter.'
                theme={theme}
              />
            )}
            {state.listing.kind === 'ready' && options.length > 0 && (
              <Select
                id='file-picker-list'
                options={options}
                selectedIndex={selected}
                onChange={setSelected}
                onSelect={(index) => select(index)}
                navigateFromInput={filterFocused}
                flexGrow={1}
                minHeight={0}
                backgroundColor={theme.card}
                textColor={theme.foreground}
                selectedTextColor={theme.foreground}
                selectedBackgroundColor={theme.accent}
                showDescription={false}
              />
            )}
          </box>
        )}
        {((wide && state.preview.kind !== 'empty') || showPreview) && (
          <FilePreview preview={state.preview} theme={theme} lines={Math.max(1, height - 8)} />
        )}
      </box>
      <text fg={theme.mutedForeground} height={1} flexShrink={0} wrapMode='none'>
        {fileViewHint({
          focus,
          width,
          previewOpen: state.preview.kind !== 'empty',
          dismissKeys,
          workbenchKeys: onOpenWorkbench
            ? commandShortcut(commands.bindings, 'workspace.openWorkbench')
            : null,
        })}
      </text>
    </box>
  )
}
