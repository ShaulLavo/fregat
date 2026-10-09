import { useKeymapNode } from '@/keymap/hooks/use-keymap-node'
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
import { cn } from '@workspace/ui/lib/utils'
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
import { openingPopupTrigger } from '@workspace/ui/patterns/popup-trigger'
import { deriveWriteTarget, policyControlledIds } from '@workspace/contracts'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { originForQueryClient } from '@/lib/environments/state/query-clients'

import { useDirectoryTransition } from '@/features/file-picker/hooks/use-directory-transition'
import { useIntentHitLog } from '@/features/file-picker/hooks/use-intent-hit-log'
import { useFilePickerPathInput } from '@/features/file-picker/hooks/use-path-input'
import { IconTooltip } from '@/components/icon-tooltip'
import { FileList } from '@/features/file-picker/components/list'
import { ColumnsView } from '@/features/file-picker/components/columns-view'
import { IconsView } from '@/features/file-picker/components/icons-view'
import {
  deepestPickable,
  folderLabel,
  initialTrail,
  pickerView,
  shownPickerView,
  visibleTrail,
  type ColumnTrail,
  type PickerView,
} from '@/features/file-picker/utils/columns'
import { useElementWidth } from '@/hooks/use-element-width'
import { useMediaQuery } from '@/features/file-picker/hooks/use-media-query'
import {
  BROWSE_MIN_PX,
  COMPACT_QUERY,
  PLACES_PANE,
  PREVIEW_PANE,
  WIDE_QUERY,
} from '@/features/file-picker/utils/panes'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { ListHeader } from '@/features/file-picker/components/list-header'
import {
  PICKER_COPY,
  ROOT_PATH,
  displayPath,
  entryByOffset,
  folderEntries,
  loadStateEntries,
  pickerParentPath,
  toPickedEntry,
  type EntriesLoadState,
} from '@/features/file-picker/utils/model'
import { NewFolderPopover } from '@/features/file-picker/components/new-folder-popover'
import { CompactHeader } from '@/features/file-picker/components/compact-header'
import { CompactMenu } from '@/features/file-picker/components/compact-menu'
import { LocationBar } from '@/features/file-picker/components/location-bar'
import { PlacesSheet } from '@/features/file-picker/components/places-sheet'
import { leadingRecentEntries } from '@/features/file-picker/utils/rows'
import { leadingListState } from '@/features/file-picker/utils/load-state'
import { PlacesSidebar } from '@/features/file-picker/components/places-sidebar'
import { PinFolderButton } from '@/features/file-picker/components/pin-folder-button'
import {
  PickerLocationActionsContext,
  type PickerLocationActions,
} from '@/features/file-picker/providers/locations-context'
import { sidebarSectionsFor } from '@/features/file-picker/utils/sidebar-locations'
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
import { listCountLabel } from '@/features/file-picker/utils/keyboard'
import {
  sortFilePickerEntries,
  type FileListSort,
  type FileListSortKey,
} from '@/features/file-picker/utils/sort-entries'
import { useSettingValue } from '@/hooks/use-setting-value'
import { usePickerBackGesture } from '@/features/file-picker/hooks/use-back-gesture'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

type FilePickerDialogProps = {
  open: boolean
  value: PickedFsEntry | null
  onOpenChange: (open: boolean) => void
  onPick: (entry: PickedFsEntry) => void
}

const INITIAL_SORT: FileListSort = { direction: 'ascending', key: 'name' }

export function FilePickerDialog({ open, value, onOpenChange, onPick }: FilePickerDialogProps) {
  const showHidden = useSettingValue('files.showHidden')
  const settings = useSettingsProjection()
  const settingsActions = useSettingsActions()
  const session = useFilePickerSession(value)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wide = useMediaQuery(WIDE_QUERY, true)
  const compact = useMediaQuery(COMPACT_QUERY, false)
  const listRef = useRef<HTMLDivElement>(null)
  const commitStartedRef = useRef(false)
  const [sort, setSort] = useState<FileListSort | null>(null)
  const {
    refresh: refreshServerInfo,
    serverInfo,
    serverInfoError,
  } = useServerInfoForOpen(
    open,
    // A phone picker starts with nothing selected; a tap opens a folder rather than selecting it.
    (info) => session.initializeOpenSession(info, !compact),
    session.resetOpenSession,
  )
  const {
    currentEntry,
    isFetching: isDirectoryFetching,
    loadState: directoryLoadState,
    refresh: refreshDirectory,
  } = useDirectoryLoad({
    currentPath: session.currentPath,
    effectiveQuery: session.effectiveQuery,
    open: open && session.isInitialized,
    serverInfo,
    showHidden,
  })
  const { places, refresh: refreshPlaces } = usePlaces(open, serverInfo)
  const { loadState: recentState, refresh: refreshRecents } = useRecentEntries({
    open,
    serverInfo,
    showHidden,
  })
  const { beginDirectoryIntent, guessDirectory, loadDirectory, preloadDirectory } =
    useDirectoryTransition({
      currentPath: session.currentPath,
      enabled: open && session.isInitialized && Boolean(serverInfo),
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
  const entries = folderEntries(sortedEntries)
  // A phone leads the folder it opened in with recent folders; the Places sheet has them anywhere.
  const leadsWithRecents =
    compact && session.isInitialized && !isSearching && session.currentPath === session.openedPath
  // Recents and the folder appear together, so no row moves under a finger once shown.
  const lead = leadingListState(loadState, recentState, leadsWithRecents)
  const leadPending = lead.pending
  const leadingRecents =
    leadsWithRecents && !leadPending
      ? leadingRecentEntries(folderEntries(loadStateEntries(recentState)))
      : []
  const listEntries = leadPending ? [] : entries
  // The rows in the order the list shows them; the keyboard walks these.
  const shownEntries = leadingRecents.length > 0 ? [...leadingRecents, ...entries] : listEntries
  const selectedEntry = selectedVisibleEntry(shownEntries, session.selectedEntry)
  const viewSetting = useSettingValue('files.picker.view')
  const chosenView = pickerView(viewSetting)
  const [middleRef, middleWidth] = useElementWidth<HTMLDivElement>()
  // A phone has room for one column of names, and no hover or double click to drive the others.
  const view = compact ? 'list' : shownPickerView(chosenView, isSearching, middleWidth)
  const [trailState, setTrailState] = useState<{ path: string; trail: ColumnTrail } | null>(null)
  const heldTrail =
    trailState?.path === session.currentPath
      ? trailState.trail
      : initialTrail(session.currentPath, selectedEntry)
  const trail = visibleTrail(heldTrail, showHidden)
  if (trail !== heldTrail) setTrailState({ path: session.currentPath, trail })
  // In columns the selection that counts is the deepest one; in the list, the list's.
  const focusedEntry = view === 'columns' ? (trail.at(-1) ?? null) : selectedEntry
  const isSearchPending = session.query.trim() !== session.effectiveQuery.trim()
  const isSearchLoading = isSearching && isDirectoryFetching
  const listInteractionPending = isSearchPending || isSearchLoading
  const previewEntry = focusedEntry ?? currentEntry
  const focusedPickable = view === 'columns' ? deepestPickable(trail) : toPickedEntry(focusedEntry)
  const selectedPickable = focusedPickable ?? currentEntry
  // The phone's Open always takes the folder its header names.
  const phoneTarget = currentEntry
  const homePath = serverInfo?.homePath ?? ROOT_PATH
  // Pins name folders on the machine being browsed, so they live in that machine's settings.
  const machine = useQueryClient()
  const machineSettings = useSettingsProjection(machine)
  const machineSettingsActions = useSettingsActions(machine)
  // Named wherever the picker can be on another machine than the screen: a phone, a remote server.
  const machineLabel = useEnvironmentsStore(
    (state) => state.entries[originForQueryClient(machine)]?.label ?? null,
  )
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
    if (path === null) return

    const intentId = beginDirectoryIntent()
    void loadDirectory(path, intentId).then((loaded) => {
      if (loaded) session.goBack()
    })
  }

  function goForward() {
    const path = session.forwardPath
    if (path === null) return

    const intentId = beginDirectoryIntent()
    void loadDirectory(path, intentId).then((loaded) => {
      if (loaded) session.goForward()
    })
  }
  const backGesture = usePickerBackGesture({
    active: open && compact,
    depth: session.backDepth,
    onBack: goBack,
    onClose: () => onOpenChange(false),
  })

  // Declaration order is a constraint, not a preference: React Compiler cannot rewrite a
  // hoisted reference, so every handler below is declared after the handlers it calls.
  function commitPick(entry: PickedFsEntry) {
    if (commitStartedRef.current) return

    commitStartedRef.current = true
    backGesture.leave(() => {
      onPick(entry)
      onOpenChange(false)
    })
  }

  function close() {
    backGesture.leave(() => onOpenChange(false))
  }

  function selectByOffset(event: KeyboardEvent<HTMLElement>, offset: number) {
    event.preventDefault()
    const nextEntry = entryByOffset(shownEntries, selectedEntry, offset)
    if (!nextEntry) return

    session.setSelectedEntry(nextEntry)
  }

  function toggleHiddenFiles() {
    if (hiddenSettingDisabled) return

    settingsActions.setSetting('files.showHidden', !showHidden, hiddenWriteTarget)
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

    const candidate = focusedEntry ?? shownEntries[0] ?? null
    // In columns the footer names the deepest pickable entry, so Enter picks that one.
    const candidatePickable =
      candidate && !(view === 'columns' && focusedEntry)
        ? toPickedEntry(candidate)
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
    if (listInteractionPending || !isDirectoryEntry(entry)) return
    navigateTo(entry.path)
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
    if (!focusedEntry || listInteractionPending || !isDirectoryEntry(focusedEntry)) return
    navigateTo(focusedEntry.path)
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
    const pickable = toPickedEntry(entry)
    if (pickable) commitPick(pickable)
  }

  const pickerRef = useKeymapNode({
    area: 'dialog',
    context: 'FilePicker',
    commands: {
      'filePicker.navigateBack': ({ source }) => {
        if (!open || openingPopupTrigger(source?.target ?? null) || session.backPath === null)
          return false
        goBack()
        return true
      },
      'filePicker.navigateForward': ({ source }) => {
        if (!open || openingPopupTrigger(source?.target ?? null) || session.forwardPath === null)
          return false
        goForward()
        return true
      },
      'filePicker.openSelected': ({ source }) => {
        if (
          !open ||
          openingPopupTrigger(source?.target ?? null) ||
          !focusedEntry ||
          listInteractionPending
        )
          return false
        if (!isDirectoryEntry(focusedEntry)) return false
        openSelected()
        return true
      },
      'filePicker.goToFolder': ({ source }) => {
        if (!open || openingPopupTrigger(source?.target ?? null)) return false
        pathInput.open()
        return true
      },
      'filePicker.toggleHidden': ({ source }) => {
        if (!open || openingPopupTrigger(source?.target ?? null) || hiddenSettingDisabled)
          return false
        toggleHiddenFiles()
        return true
      },
      'filePicker.goUp': ({ source }) => {
        if (!open || openingPopupTrigger(source?.target ?? null) || !session.canGoUp) return false
        navigateTo(pickerParentPath(session.currentPath))
        return true
      },
    },
  })

  function handleDialogKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return
    // A descendant popup (new-folder, places) can still have focus on its trigger while its
    // popup opens; the dialog must yield to it so Escape closes only the innermost layer.
    if (openingPopupTrigger(event.target)) return
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

  const searchField = (
    <InputGroup
      className={cn(
        'h-(--density-control-height-sm)',
        compact ? 'min-w-0 flex-1' : 'w-52 shrink-0',
      )}
    >
      <InputGroupAddon align='inline-start'>
        <MagnifyingGlassIcon aria-hidden='true' className='size-(--icon-size-sm)' />
      </InputGroupAddon>
      <InputGroupInput
        ref={searchInputRef}
        aria-label={PICKER_COPY.searchLabel}
        autoCapitalize='off'
        autoComplete='off'
        autoCorrect='off'
        // On a phone focus would raise the keyboard over the list before anything was asked.
        autoFocus={!compact}
        className='h-full text-xs'
        onChange={handleSearchChange}
        onKeyDown={handleSearchKeyDown}
        placeholder={searchPlaceholder(PICKER_COPY.searchPlaceholder, machineLabel, compact)}
        spellCheck={false}
        value={session.query}
      />
    </InputGroup>
  )

  const folderActions = (
    <div
      aria-label='Folder display actions'
      className='flex shrink-0 items-center gap-0.5'
      role='group'
    >
      <IconTooltip label='Refresh'>
        <Button aria-label='Refresh' onClick={refresh} size='icon-sm' type='button' variant='ghost'>
          <ArrowClockwiseIcon />
        </Button>
      </IconTooltip>
      <NewFolderPopover currentPath={session.currentPath} onCreated={handleFolderCreated} />
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
  )

  const browsing = (
    <div className='bg-background h-full min-h-0' ref={middleRef}>
      {view === 'columns' ? (
        <ColumnsView
          columnWidths={session.columnWidths}
          currentPath={session.currentPath}
          isBusy={listInteractionPending}
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
          selectedPath={selectedEntry?.path ?? null}
          onCommitEntry={commitEntry}
          onEntryDoubleClick={handleEntryDoubleClick}
          onGoParent={() => {
            if (session.canGoUp) navigateTo(pickerParentPath(session.currentPath))
          }}
        />
      ) : (
        <div
          className={cn(
            'grid h-full min-h-0',
            compact ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]',
          )}
        >
          {/* On a phone the sort lives in the bar's menu; a one-column header would only say Name. */}
          {compact ? null : (
            <ListHeader
              isLoading={loadState.status === 'loading' || listInteractionPending}
              isSearching={isSearching}
              onSort={handleSort}
              sort={effectiveSort}
            />
          )}
          <FileList
            entries={listEntries}
            isBusy={listInteractionPending}
            isSearching={isSearching}
            listRef={listRef}
            loadState={lead.state}
            onDirectoryIntent={guessDirectory}
            onEntryDoubleClick={handleEntryDoubleClick}
            onCommitEntry={commitEntry}
            onGoParent={() => {
              if (session.canGoUp) navigateTo(pickerParentPath(session.currentPath))
            }}
            onRetry={refresh}
            recents={
              leadingRecents.length > 0
                ? { entries: leadingRecents, folder: folderLabel(session.currentPath) }
                : null
            }
            touch={compact}
            selectedPath={selectedEntry?.path ?? null}
          />
        </div>
      )}
    </div>
  )

  return (
    <Dialog onOpenChange={(next) => (next ? onOpenChange(true) : close())} open={open}>
      <DialogContent
        className='bg-popover-solid flex h-[min(760px,calc(100svh-2rem))] w-[min(1080px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden p-0 text-sm max-sm:h-dvh max-sm:w-full max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[max(env(safe-area-inset-bottom),var(--keyboard-inset,0px))] sm:max-w-none'
        ref={pickerRef}
        onKeyDownCapture={handleDialogKeyDownCapture}
        showCloseButton={false}
      >
        <FilePickerSessionActionsContext value={sessionActions}>
          <PickerLocationActionsContext value={locationActions}>
            {/* Named for assistive tech only. On screen the dialog is its own label:
              the breadcrumb says where you are and the commit button says what
              will happen, so a title bar repeating both is chrome for nothing. */}
            <DialogHeader className='sr-only'>
              <DialogTitle>{PICKER_COPY.title}</DialogTitle>
              <DialogDescription>
                {machineLabel
                  ? `Browsing ${displayPath(session.currentPath)} on ${machineLabel}.`
                  : `Browsing ${displayPath(session.currentPath)}.`}
              </DialogDescription>
            </DialogHeader>

            {compact ? (
              <>
                <CompactHeader
                  actions={
                    <>
                      <NewFolderPopover
                        currentPath={session.currentPath}
                        onCreated={handleFolderCreated}
                      />
                      <CompactMenu
                        currentPath={session.currentPath}
                        hiddenDisabled={hiddenSettingDisabled}
                        onGoToFolder={pathInput.open}
                        onRefresh={refresh}
                        onSort={setSort}
                        onToggleHidden={toggleHiddenFiles}
                        showHidden={showHidden}
                        sort={effectiveSort}
                      />
                    </>
                  }
                  backPath={session.backPath}
                  canGoUp={session.canGoUp}
                  currentPath={session.currentPath}
                  editor={
                    pathInput.isEditing ? (
                      <LocationBar
                        className='flex-1'
                        currentPath={session.currentPath}
                        draft={pathInput.draft}
                        error={pathInput.error}
                        inputRef={pathInput.inputRef}
                        isEditing
                        isPending={pathInput.isPending || isDirectoryFetching}
                        onCancel={pathInput.close}
                        onChange={pathInput.change}
                        onEdit={pathInput.open}
                        onSubmit={pathInput.submit}
                      />
                    ) : null
                  }
                  onBack={goBack}
                  onClose={close}
                  onEditPath={pathInput.open}
                  onUp={() => navigateTo(pickerParentPath(session.currentPath))}
                />
                <div className='flex gap-(--density-gap-tight) px-(--bar-padding-x)'>
                  {searchField}
                  <PlacesSheet
                    currentPath={session.currentPath}
                    labelled
                    recentState={recentState}
                    sections={sections}
                  />
                </div>
              </>
            ) : (
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
                  isPending={pathInput.isPending || isDirectoryFetching}
                  onCancel={pathInput.close}
                  onChange={pathInput.change}
                  onEdit={pathInput.open}
                  onSubmit={pathInput.submit}
                />
                {wide ? null : (
                  <PlacesSheet
                    currentPath={session.currentPath}
                    labelled={false}
                    recentState={recentState}
                    sections={sections}
                  />
                )}
                {searchField}
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
                {folderActions}
              </PaneBar>
            )}

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
                    entry={previewEntry}
                    isSearching={isSearching}
                    showHidden={showHidden}
                  />
                </ResizablePanel>
              </PersistedResizablePanelGroup>
            ) : (
              <div className='min-h-0 flex-1'>{browsing}</div>
            )}

            {compact ? (
              <DialogFooter className='flex shrink-0 flex-row gap-(--density-control-gap) px-(--bar-padding-x) py-(--density-gap-tight)'>
                <Button
                  className='shrink-0'
                  onClick={close}
                  size='lg'
                  type='button'
                  variant='secondary'
                >
                  Cancel
                </Button>
                <Button
                  className='min-w-0 flex-1'
                  size='lg'
                  disabled={!phoneTarget}
                  onClick={() => {
                    if (phoneTarget) commitPick(phoneTarget)
                  }}
                  title={phoneTarget ? displayPath(phoneTarget.path) : undefined}
                  type='button'
                >
                  {PICKER_COPY.chooseLabel}
                </Button>
              </DialogFooter>
            ) : (
              <DialogFooter className='flex h-(--bar-height) shrink-0 flex-row items-center justify-between gap-(--density-control-gap) px-(--bar-padding-x) sm:justify-between'>
                <SelectedSummary entry={selectedPickable} />
                <span
                  className='text-muted-foreground text-2xs ml-auto shrink-0 font-mono tabular-nums'
                  role='status'
                >
                  {loadState.status === 'loading'
                    ? null
                    : listCountLabel(entries.length, isSearching)}
                </span>
                <div className='flex shrink-0 gap-1.5'>
                  <Button onClick={close} size='sm' type='button' variant='ghost'>
                    Cancel
                  </Button>
                  <Button
                    disabled={!selectedPickable}
                    onClick={chooseSelected}
                    size='sm'
                    type='button'
                  >
                    {PICKER_COPY.chooseLabel}
                  </Button>
                </div>
              </DialogFooter>
            )}
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

/** The phone's Places button shares the row, so its field keeps a word that always fits. */
function searchPlaceholder(placeholder: string, machineLabel: string | null, compact: boolean) {
  if (compact) return 'Search'
  return machineLabel ? `${placeholder} on ${machineLabel}` : placeholder
}
