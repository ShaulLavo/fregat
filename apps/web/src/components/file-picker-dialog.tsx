import { errorMessage } from '@/lib/error-message'
import type { FsEntry, PickedFsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ColumnsIcon,
  GridFourIcon,
  ListIcon,
  EyeIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@workspace/ui/components/input-group'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import {
  PersistedResizablePanelGroup,
  ResizableHandle,
  ResizablePanel,
} from '@workspace/ui/components/resizable'
import { Separator } from '@workspace/ui/components/separator'
import { deriveWriteTarget, policyControlledIds } from '@workspace/contracts'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useDirectoryTransition } from '@/features/file-picker/hooks/use-directory-transition'
import { useIntentHitLog } from '@/features/file-picker/hooks/use-intent-hit-log'
import { useFilePickerPathInput } from '@/features/file-picker/hooks/use-path-input'
import { IconTooltip } from '@/components/icon-tooltip'
import { FileList } from '@/features/file-picker/components/list'
import { ColumnsView } from '@/features/file-picker/components/columns-view'
import { IconsView } from '@/features/file-picker/components/icons-view'
import {
  deepestPickable,
  initialTrail,
  pickerView,
  shownPickerView,
  visibleTrail,
  type ColumnTrail,
  type PickerView,
} from '@/features/file-picker/utils/columns'
import { useElementWidth } from '@/hooks/use-element-width'
import { useWideLayout } from '@/features/file-picker/hooks/use-wide-layout'
import { BROWSE_MIN_PX, PLACES_PANE, PREVIEW_PANE } from '@/features/file-picker/utils/panes'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { ListHeader } from '@/features/file-picker/components/list-header'
import {
  ROOT_PATH,
  currentPickableEntry,
  displayPath,
  entryByOffset,
  loadStateEntries,
  pickerParentPath,
  pickerCopy,
  toPickedEntry,
  type EntriesLoadState,
  type FilePickerMode,
} from '@/features/file-picker/utils/model'
import { NewFolderPopover } from '@/features/file-picker/components/new-folder-popover'
import { LocationBar } from '@/features/file-picker/components/location-bar'
import { MobileLocations } from '@/features/file-picker/components/mobile-locations'
import { PlacesSidebar } from '@/features/file-picker/components/places-sidebar'
import { PinFolderButton } from '@/features/file-picker/components/pin-folder-button'
import {
  PickerLocationActionsContext,
  type PickerLocationActions,
} from '@/features/file-picker/providers/locations-context'
import { sidebarSectionsFor } from '@/features/file-picker/utils/sidebar-locations'
import { TypeFilter } from '@/features/file-picker/components/type-filter'
import {
  filterPickerEntries,
  filterPickerTrail,
  pickerAccept,
} from '@/features/file-picker/utils/type-filter'
import { PreviewPane } from '@/features/file-picker/components/preview'
import { SelectedSummary } from '@/features/file-picker/components/selected-summary'
import {
  FilePickerSessionActionsContext,
  type FilePickerSessionActions,
} from '@/features/file-picker/providers/session-actions-context'
import { useFilePickerSession } from '@/features/file-picker/state/picker'
import { useDirectoryLoad } from '@/features/file-picker/hooks/use-directory-load'
import { useRecentEntries } from '@/features/file-picker/hooks/use-recent-entries'
import { usePlaces } from '@/features/file-picker/hooks/use-places'
import { useServerInfoForOpen } from '@/features/file-picker/hooks/use-server-info-for-open'
import {
  isBackShortcut,
  isForwardShortcut,
  isGoToFolderShortcut,
  isGoUpShortcut,
  isOpenShortcut,
  isToggleHiddenShortcut,
  listCountLabel,
} from '@/features/file-picker/utils/keyboard'
import {
  sortFilePickerEntries,
  type FileListSort,
  type FileListSortKey,
} from '@/features/file-picker/utils/sort-entries'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

type FilePickerDialogProps = {
  accept?: readonly string[]
  mode?: FilePickerMode
  open: boolean
  value: PickedFsEntry | null
  onOpenChange: (open: boolean) => void
  onPick: (entry: PickedFsEntry) => void
}

const INITIAL_SORT: FileListSort = { direction: 'ascending', key: 'name' }

export type { FilePickerMode }

export function FilePickerDialog({
  accept,
  mode = 'folder',
  open,
  value,
  onOpenChange,
  onPick,
}: FilePickerDialogProps) {
  const showHidden = useSettingValue('files.showHidden')
  const settings = useSettingsProjection()
  const settingsActions = useSettingsActions()
  const session = useFilePickerSession(value)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const commitStartedRef = useRef(false)
  const [typeFilter, setTypeFilter] = useState('')
  const selectedType = accept?.includes(typeFilter) ? typeFilter : ''
  const activeAccept = mode === 'file' ? pickerAccept(accept, selectedType) : undefined
  const [sort, setSort] = useState<FileListSort | null>(null)
  const {
    refresh: refreshServerInfo,
    serverInfo,
    serverInfoError,
  } = useServerInfoForOpen(open, session.initializeOpenSession, session.resetOpenSession)
  const {
    currentEntry,
    isFetching: isDirectoryFetching,
    loadState: directoryLoadState,
    refresh: refreshDirectory,
  } = useDirectoryLoad({
    currentPath: session.currentPath,
    effectiveQuery: session.effectiveQuery,
    mode,
    open: open && session.isInitialized,
    serverInfo,
    showHidden,
  })
  const { places, refresh: refreshPlaces } = usePlaces(open, serverInfo)
  const { loadState: recentState, refresh: refreshRecents } = useRecentEntries({
    mode,
    open,
    serverInfo,
    showHidden,
  })
  const { beginDirectoryIntent, guessDirectory, loadDirectory, preloadDirectory } =
    useDirectoryTransition({
      currentPath: session.currentPath,
      enabled: open && session.isInitialized && Boolean(serverInfo),
      mode,
      showHidden,
    })
  useIntentHitLog(open)
  const navigateSessionTo = session.navigateTo
  const selectSessionEntry = session.setSelectedEntry
  const loadAndNavigate = (path: string, intentId: number) => {
    void loadDirectory(path, intentId).then((loaded) => {
      if (loaded) navigateSessionTo(path)
    })
  }
  const navigateTo = (path: string) => {
    loadAndNavigate(path, beginDirectoryIntent())
  }
  const navigateSelecting = (path: string, entry: FsEntry | null) => {
    const intentId = beginDirectoryIntent()
    void loadDirectory(path, intentId).then((loaded) => {
      if (!loaded) return

      navigateSessionTo(path)
      if (entry) selectSessionEntry(entry)
    })
  }
  const revealEntry = (entry: FsEntry) => {
    if (isDirectoryEntry(entry)) return navigateSelecting(entry.path, null)
    navigateSelecting(pickerParentPath(entry.path), entry)
  }
  const pathInput = useFilePickerPathInput({
    currentPath: session.currentPath,
    onIntentStart: beginDirectoryIntent,
    onNavigate: loadAndNavigate,
    serverInfo,
  })
  const loadState: EntriesLoadState = serverInfoError
    ? {
        status: 'error',
        message: errorMessage(serverInfoError, 'The file server did not return a usable response.'),
      }
    : directoryLoadState
  const loadedEntries = loadStateEntries(loadState)
  const isSearching = session.query.trim().length > 0
  const effectiveSort = sort ?? (isSearching ? null : INITIAL_SORT)
  // Compiler audit: needed; it leaves this sorted list unmemoized without these input keys.
  const sortedEntries = useMemo(
    () => (effectiveSort ? sortFilePickerEntries(loadedEntries, effectiveSort) : loadedEntries),
    [effectiveSort, loadedEntries],
  )
  const entries = filterPickerEntries(sortedEntries, mode, activeAccept)
  const selectedEntry = selectedVisibleEntry(entries, session.selectedEntry)
  const viewSetting = useSettingValue('files.picker.view')
  const chosenView = pickerView(viewSetting, mode)
  const [middleRef, middleWidth] = useElementWidth<HTMLDivElement>()
  const wide = useWideLayout()
  const view = shownPickerView(chosenView, isSearching, middleWidth)
  const [trailState, setTrailState] = useState<{ path: string; trail: ColumnTrail } | null>(null)
  const heldTrail =
    trailState?.path === session.currentPath
      ? trailState.trail
      : initialTrail(session.currentPath, selectedEntry)
  const trail = filterPickerTrail(visibleTrail(heldTrail, showHidden), activeAccept)
  if (trail !== heldTrail) setTrailState({ path: session.currentPath, trail })
  // In columns the selection that counts is the deepest one; in the list, the list's.
  const focusedEntry = view === 'columns' ? (trail.at(-1) ?? null) : selectedEntry
  const isSearchPending = session.query.trim() !== session.effectiveQuery.trim()
  const isSearchLoading = isSearching && isDirectoryFetching
  const listInteractionPending = isSearchPending || isSearchLoading
  const previewEntry = focusedEntry ?? currentEntry
  const focusedPickable =
    view === 'columns'
      ? deepestPickable(trail, mode, activeAccept)
      : toPickedEntry(focusedEntry, mode, activeAccept)
  const selectedPickable = focusedPickable ?? currentPickableEntry(currentEntry, mode)
  const homePath = serverInfo?.homePath ?? ROOT_PATH
  // Pins name folders on the machine being browsed, so they live in that machine's settings.
  const machine = useQueryClient()
  const machineSettings = useSettingsProjection(machine)
  const machineSettingsActions = useSettingsActions(machine)
  const pinned = machineSettings?.values['files.picker.pinnedLocations'] ?? []
  const hidden = machineSettings?.values['files.picker.hiddenLocations'] ?? []
  const sections = sidebarSectionsFor({ data: places, hidden, homePath, pinned })
  const setLocations = (
    key: 'files.picker.pinnedLocations' | 'files.picker.hiddenLocations',
    next: readonly string[],
  ) => machineSettingsActions.setSetting(key, [...new Set(next)], 'user')
  const locationActions: PickerLocationActions = {
    hiddenCount: hidden.length,
    hide: (path) => setLocations('files.picker.hiddenLocations', [...hidden, path]),
    pin: (path) => {
      setLocations('files.picker.pinnedLocations', [...pinned, path])
      if (hidden.includes(path))
        setLocations(
          'files.picker.hiddenLocations',
          hidden.filter((entry) => entry !== path),
        )
    },
    pinned,
    restoreHidden: () => setLocations('files.picker.hiddenLocations', []),
    unpin: (path) =>
      setLocations(
        'files.picker.pinnedLocations',
        pinned.filter((entry) => entry !== path),
      ),
  }
  const settingsLayers = settings?.layers ?? []
  const hiddenWriteTarget = deriveWriteTarget('files.showHidden', settingsLayers)
  const hiddenManagedByPolicy = policyControlledIds(settingsLayers).includes('files.showHidden')
  const hiddenSettingDisabled = !settings || hiddenManagedByPolicy
  const copy = pickerCopy(mode)
  // The list rows consume these actions through context, so identity must stay
  // stable while typing or scrolling to avoid rerendering every visible row.
  const sessionActions: FilePickerSessionActions = {
    jumpTo: navigateTo,
    navigateTo,
    resizeColumn: session.setColumnWidth,
    revealEntry,
    selectEntry: session.setSelectedEntry,
  }

  useEffect(() => {
    if (open) commitStartedRef.current = false
  }, [open])

  useEffect(() => {
    if (!focusedEntry || !isDirectoryEntry(focusedEntry)) return

    void preloadDirectory(focusedEntry.path)
  }, [preloadDirectory, focusedEntry])

  function refresh() {
    void Promise.all([refreshDirectory(), refreshRecents(), refreshPlaces(), refreshServerInfo()])
  }

  function goBack() {
    const path = session.backPath
    if (!path) return

    const intentId = beginDirectoryIntent()
    void loadDirectory(path, intentId).then((loaded) => {
      if (loaded) session.goBack()
    })
  }

  function goForward() {
    const path = session.forwardPath
    if (!path) return

    const intentId = beginDirectoryIntent()
    void loadDirectory(path, intentId).then((loaded) => {
      if (loaded) session.goForward()
    })
  }

  // Declaration order is a constraint, not a preference: React Compiler cannot rewrite a
  // hoisted reference, so every handler below is declared after the handlers it calls.
  function commitPick(entry: PickedFsEntry) {
    if (commitStartedRef.current) return

    commitStartedRef.current = true
    onPick(entry)
    onOpenChange(false)
  }

  function selectByOffset(event: KeyboardEvent<HTMLElement>, offset: number) {
    event.preventDefault()
    const nextEntry = entryByOffset(entries, selectedEntry, offset)
    if (!nextEntry) return

    session.setSelectedEntry(nextEntry)
  }

  function toggleHiddenFiles() {
    if (hiddenSettingDisabled) return

    settingsActions.setSetting('files.showHidden', !showHidden, hiddenWriteTarget)
  }

  function leaveDirectory(event: KeyboardEvent<HTMLElement>) {
    if (!session.canGoUp) return

    event.preventDefault()
    navigateTo(pickerParentPath(session.currentPath))
  }

  function chooseSelected() {
    if (!selectedPickable) return

    commitPick(selectedPickable)
  }

  function commitFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (listInteractionPending) {
      event.preventDefault()
      return
    }

    const candidate = focusedEntry ?? entries[0] ?? null
    if (candidate && isDirectoryEntry(candidate) && mode === 'file') {
      event.preventDefault()
      navigateTo(candidate.path)
      return
    }

    // In columns the footer names the deepest pickable entry, so Enter picks that one.
    const candidatePickable =
      candidate && !(view === 'columns' && focusedEntry)
        ? toPickedEntry(candidate, mode, activeAccept)
        : selectedPickable
    if (!candidatePickable) return

    event.preventDefault()
    commitPick(candidatePickable)
  }

  function focusListFromSearch(event: KeyboardEvent<HTMLInputElement>, offset: number) {
    event.preventDefault()
    if (view === 'columns') {
      event.currentTarget
        .closest('[data-slot="dialog-content"]')
        ?.querySelector<HTMLElement>('[data-picker-column="0"]')
        ?.focus()
      return
    }
    listRef.current?.focus()
    if (listInteractionPending) return

    selectByOffset(event, offset)
  }

  function handleEntryDoubleClick(entry: FsEntry) {
    if (listInteractionPending) return
    if (isDirectoryEntry(entry)) {
      navigateTo(entry.path)
      return
    }

    const picked = toPickedEntry(entry, mode, activeAccept)
    if (!picked) return

    commitPick(picked)
  }

  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    if (!session.query.trim() && event.target.value.trim()) setSort(null)
    session.setSelectedEntry(null)
    session.setQuery(event.target.value)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') return commitFromKeyboard(event)
    if (event.key === 'ArrowDown') return focusListFromSearch(event, 1)
    if (event.key === 'ArrowUp') return focusListFromSearch(event, -1)
  }

  function openSelected() {
    if (!focusedEntry || listInteractionPending) return
    if (isDirectoryEntry(focusedEntry)) return navigateTo(focusedEntry.path)
    const picked = toPickedEntry(focusedEntry, mode, activeAccept)
    if (picked) commitPick(picked)
  }

  function changeTrail(next: ColumnTrail) {
    setTrailState({ path: session.currentPath, trail: next })
    session.setSelectedEntry(next[0] ?? null)
  }

  // Columns show a selection deeper than the current folder; list and icons show one folder,
  // so a switch opens the deepest selection's folder and a return rebuilds the trail from it.
  function carrySelection(next: PickerView) {
    if (next === 'columns') return setTrailState(null)
    if (view !== 'columns') return
    const deepest = trail.at(-1)
    if (!deepest) return
    const folder = pickerParentPath(deepest.path)
    if (folder === session.currentPath) return session.setSelectedEntry(deepest)
    navigateSelecting(folder, deepest)
  }

  function chooseView(next: PickerView) {
    carrySelection(next)
    settingsActions.setSetting(
      'files.picker.view',
      next,
      deriveWriteTarget('files.picker.view', settingsLayers),
    )
  }

  function commitEntry(entry: FsEntry) {
    if (isDirectoryEntry(entry) && mode === 'file') {
      navigateTo(entry.path)
      return
    }
    const pickable = toPickedEntry(entry, mode, activeAccept)
    if (pickable) commitPick(pickable)
  }

  function historyChord(event: KeyboardEvent<HTMLDivElement>) {
    if (isBackShortcut(event)) return goBack
    if (isForwardShortcut(event)) return goForward
    if (isOpenShortcut(event)) return openSelected
    return null
  }

  function handleDialogKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return
    const chord = historyChord(event)
    if (chord) {
      event.preventDefault()
      event.stopPropagation()
      chord()
      return
    }
    if (isGoToFolderShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      pathInput.open()
      return
    }
    if (isToggleHiddenShortcut(event)) {
      event.preventDefault()
      event.stopPropagation()
      toggleHiddenFiles()
      return
    }
    if (isGoUpShortcut(event)) {
      leaveDirectory(event)
      event.stopPropagation()
      return
    }
    if (event.key !== 'Escape') return
    if (pathInput.isEditing) {
      event.preventDefault()
      event.stopPropagation()
      pathInput.close()
      return
    }
    if (!session.query) return

    event.preventDefault()
    event.stopPropagation()
    session.setQuery('')
    session.setSelectedEntry(null)
    searchInputRef.current?.focus()
  }

  function handleSort(key: FileListSortKey) {
    setSort((current) => {
      const activeSort = current ?? (isSearching ? null : INITIAL_SORT)

      return {
        direction:
          activeSort?.key === key && activeSort.direction === 'ascending'
            ? 'descending'
            : 'ascending',
        key,
      }
    })
  }

  function handleFolderCreated(entry: FsEntry) {
    session.setQuery('')
    session.setSelectedEntry(entry)
  }

  const browsing = (
    <div className='bg-background h-full min-h-0' ref={middleRef}>
      {view === 'columns' ? (
        <ColumnsView
          accept={activeAccept}
          columnWidths={session.columnWidths}
          currentPath={session.currentPath}
          isBusy={listInteractionPending}
          mode={mode}
          showHidden={showHidden}
          trail={trail}
          onCommit={commitEntry}
          onDirectoryIntent={guessDirectory}
          onGoParent={() => {
            // Finder keeps the folder just left selected in the new first column.
            if (session.canGoUp)
              navigateSelecting(pickerParentPath(session.currentPath), currentEntry)
          }}
          onOpen={handleEntryDoubleClick}
          onTrailChange={changeTrail}
        />
      ) : view === 'icons' ? (
        <IconsView
          entries={entries}
          isBusy={listInteractionPending}
          listRef={listRef}
          loadState={loadState}
          onRetry={refresh}
          mode={mode}
          selectedPath={selectedEntry?.path ?? null}
          onCommitEntry={commitEntry}
          onEntryDoubleClick={handleEntryDoubleClick}
          onGoParent={() => {
            if (session.canGoUp) navigateTo(pickerParentPath(session.currentPath))
          }}
        />
      ) : (
        <div className='grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]'>
          <ListHeader
            isLoading={loadState.status === 'loading' || listInteractionPending}
            isSearching={isSearching}
            mode={mode}
            onSort={handleSort}
            sort={effectiveSort}
          />
          <FileList
            accept={activeAccept}
            entries={entries}
            isBusy={listInteractionPending}
            isSearching={isSearching}
            listRef={listRef}
            loadState={loadState}
            mode={mode}
            onDirectoryIntent={guessDirectory}
            onEntryDoubleClick={handleEntryDoubleClick}
            onCommitEntry={commitEntry}
            onGoParent={() => {
              if (session.canGoUp) navigateTo(pickerParentPath(session.currentPath))
            }}
            onRetry={refresh}
            selectedPath={selectedEntry?.path ?? null}
          />
        </div>
      )}
    </div>
  )

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className='bg-popover-solid flex h-[min(760px,calc(100svh-2rem))] w-[min(1080px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 text-sm sm:max-w-none'
        onKeyDownCapture={handleDialogKeyDownCapture}
        showCloseButton={false}
      >
        <FilePickerSessionActionsContext value={sessionActions}>
          <PickerLocationActionsContext value={locationActions}>
            {/* Named for assistive tech only. On screen the dialog is its own label:
              the breadcrumb says where you are and the commit button says what
              will happen, so a title bar repeating both is chrome for nothing. */}
            <DialogHeader className='sr-only'>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{`Browsing ${displayPath(session.currentPath)}.`}</DialogDescription>
            </DialogHeader>

            <PaneBar>
              <div
                aria-label='Folder history'
                className='flex shrink-0 items-center gap-0.5'
                role='group'
              >
                <IconTooltip label='Back' shortcut='Mod+['>
                  <Button
                    aria-keyshortcuts='Meta+['
                    aria-label='Back'
                    disabled={!session.canGoBack}
                    focusableWhenDisabled
                    onClick={goBack}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <ArrowLeftIcon />
                  </Button>
                </IconTooltip>
                <IconTooltip label='Forward' shortcut='Mod+]'>
                  <Button
                    aria-keyshortcuts='Meta+]'
                    aria-label='Forward'
                    disabled={!session.canGoForward}
                    focusableWhenDisabled
                    onClick={goForward}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <ArrowRightIcon />
                  </Button>
                </IconTooltip>
                <IconTooltip label='Up one folder' shortcut='Mod+ArrowUp'>
                  <Button
                    aria-keyshortcuts='Meta+ArrowUp'
                    aria-label='Up one folder'
                    disabled={!session.canGoUp}
                    focusableWhenDisabled
                    onClick={() => navigateTo(pickerParentPath(session.currentPath))}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <ArrowUpIcon />
                  </Button>
                </IconTooltip>
              </div>
              <Separator className='h-4' orientation='vertical' />
              <LocationBar
                currentPath={session.currentPath}
                draft={pathInput.draft}
                error={pathInput.error}
                inputRef={pathInput.inputRef}
                isEditing={pathInput.isEditing}
                isPending={pathInput.isPending}
                onCancel={pathInput.close}
                onChange={pathInput.change}
                onEdit={pathInput.open}
                onSubmit={pathInput.submit}
              />
              <InputGroup className='h-(--density-control-height-sm) w-52 shrink-0 max-sm:w-32'>
                <InputGroupAddon align='inline-start'>
                  <MagnifyingGlassIcon aria-hidden='true' className='size-(--icon-size-sm)' />
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInputRef}
                  aria-label={copy.searchLabel}
                  autoCapitalize='off'
                  autoComplete='off'
                  autoCorrect='off'
                  autoFocus
                  className='h-full text-xs'
                  onChange={handleSearchChange}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={copy.searchPlaceholder}
                  spellCheck={false}
                  value={session.query}
                />
              </InputGroup>
              <Tabs value={chosenView} onValueChange={(next: PickerView) => chooseView(next)}>
                <TabsList aria-label='View' variant='segmented'>
                  <IconTooltip label='Columns'>
                    <TabsTab
                      aria-label='Columns'
                      className='w-(--density-control-height-sm) px-0'
                      value='columns'
                    >
                      <ColumnsIcon />
                    </TabsTab>
                  </IconTooltip>
                  <IconTooltip label='List'>
                    <TabsTab
                      aria-label='List'
                      className='w-(--density-control-height-sm) px-0'
                      value='list'
                    >
                      <ListIcon />
                    </TabsTab>
                  </IconTooltip>
                  <IconTooltip label='Icons'>
                    <TabsTab
                      aria-label='Icons'
                      className='w-(--density-control-height-sm) px-0'
                      value='icons'
                    >
                      <GridFourIcon />
                    </TabsTab>
                  </IconTooltip>
                </TabsList>
              </Tabs>
              <Separator className='h-4' orientation='vertical' />
              <div
                aria-label='Folder display actions'
                className='flex shrink-0 items-center gap-0.5'
                role='group'
              >
                <IconTooltip label='Refresh'>
                  <Button
                    aria-label='Refresh'
                    onClick={refresh}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    <ArrowClockwiseIcon />
                  </Button>
                </IconTooltip>
                <NewFolderPopover
                  currentPath={session.currentPath}
                  onCreated={handleFolderCreated}
                />
                <PinFolderButton currentPath={session.currentPath} />
                <IconTooltip
                  label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                  shortcut='Mod+Shift+.'
                >
                  <Button
                    aria-keyshortcuts='Meta+Shift+.'
                    aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                    aria-pressed={showHidden}
                    disabled={hiddenSettingDisabled}
                    focusableWhenDisabled
                    onClick={toggleHiddenFiles}
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                  >
                    {showHidden ? <EyeIcon /> : <EyeSlashIcon />}
                  </Button>
                </IconTooltip>
              </div>
            </PaneBar>

            <div className='px-(--bar-padding-x) lg:hidden'>
              <MobileLocations
                currentPath={session.currentPath}
                recentState={recentState}
                sections={sections}
              />
            </div>

            {wide ? (
              <PersistedResizablePanelGroup
                className='min-h-0 flex-1'
                id='file-picker'
                storageKey='file-picker'
              >
                <ResizablePanel
                  className='min-h-0'
                  defaultSize={PLACES_PANE.defaultPx}
                  id='places'
                  maxSize={PLACES_PANE.maxPx}
                  minSize={PLACES_PANE.minPx}
                >
                  <PlacesSidebar
                    currentPath={session.currentPath}
                    recentState={recentState}
                    sections={sections}
                  />
                </ResizablePanel>
                <ResizableHandle id='places-handle' withHandle />
                <ResizablePanel className='min-h-0 min-w-0' id='browse' minSize={BROWSE_MIN_PX}>
                  {browsing}
                </ResizablePanel>
                <ResizableHandle id='preview-handle' withHandle />
                <ResizablePanel
                  className='min-h-0 min-w-0'
                  defaultSize={PREVIEW_PANE.defaultPx}
                  id='preview'
                  maxSize={PREVIEW_PANE.maxPx}
                  minSize={PREVIEW_PANE.minPx}
                >
                  <PreviewPane
                    accept={activeAccept}
                    entry={previewEntry}
                    isSearching={isSearching}
                    mode={mode}
                    showHidden={showHidden}
                  />
                </ResizablePanel>
              </PersistedResizablePanelGroup>
            ) : (
              <div className='min-h-0 flex-1'>{browsing}</div>
            )}

            {mode === 'file' && accept?.length ? (
              <PaneBar className='shrink-0 justify-end'>
                <span className='text-muted-foreground text-xs'>File type</span>
                <TypeFilter
                  accept={accept}
                  value={selectedType}
                  onChange={(next) => {
                    setTypeFilter(next)
                    const chosen = session.selectedEntry
                    if (
                      chosen &&
                      !filterPickerEntries([chosen], mode, pickerAccept(accept, next)).length
                    )
                      session.setSelectedEntry(null)
                  }}
                />
              </PaneBar>
            ) : null}
            <DialogFooter className='flex h-(--bar-height) shrink-0 flex-row items-center justify-between gap-(--density-control-gap) px-(--bar-padding-x) sm:justify-between'>
              <SelectedSummary entry={selectedPickable} mode={mode} />
              <span
                className='text-muted-foreground text-2xs ml-auto shrink-0 font-mono tabular-nums'
                role='status'
              >
                {loadState.status === 'loading'
                  ? null
                  : listCountLabel(entries.length, isSearching)}
              </span>
              <div className='flex shrink-0 gap-1.5'>
                <Button onClick={() => onOpenChange(false)} size='sm' type='button' variant='ghost'>
                  Cancel
                </Button>
                <Button
                  disabled={!selectedPickable}
                  onClick={chooseSelected}
                  size='sm'
                  type='button'
                >
                  {copy.chooseLabel}
                </Button>
              </div>
            </DialogFooter>
          </PickerLocationActionsContext>
        </FilePickerSessionActionsContext>
      </DialogContent>
    </Dialog>
  )
}

function selectedVisibleEntry(entries: readonly FsEntry[], selected: FsEntry | null) {
  if (!selected) return null

  return entries.find((entry) => entry.path === selected.path) ?? null
}
