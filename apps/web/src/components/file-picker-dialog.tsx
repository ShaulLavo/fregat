import { errorMessage } from '@/lib/error-message'
import type { FsEntry, PickedFsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
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
import { Input } from '@workspace/ui/components/input'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Separator } from '@workspace/ui/components/separator'
import { deriveWriteTarget, policyControlledIds } from '@workspace/contracts'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'

import { useDirectoryTransition } from '@/features/file-picker/hooks/use-directory-transition'
import { useFilePickerPathInput } from '@/features/file-picker/hooks/use-path-input'
import { IconTooltip } from '@/features/file-picker/icon-tooltip'
import { FileList, ListHeader, type FileListKeyboardContext } from '@/features/file-picker/list'
import {
  ROOT_PATH,
  currentPickableEntry,
  displayPath,
  entryByOffset,
  loadStateEntries,
  parentPath,
  pickerCopy,
  toPickedEntry,
  type EntriesLoadState,
  type FilePickerIconMode,
  type FilePickerMode,
} from '@/features/file-picker/model'
import { NewFolderPopover } from '@/features/file-picker/new-folder-popover'
import { LocationBar } from '@/features/file-picker/navigation/location-bar'
import { MobileLocations } from '@/features/file-picker/navigation/mobile-locations'
import { PlacesSidebar } from '@/features/file-picker/navigation/places-sidebar'
import { PreviewPane, SelectedSummary } from '@/features/file-picker/preview'
import {
  FilePickerSessionActionsContext,
  type FilePickerSessionActions,
} from '@/features/file-picker/providers/session-actions-context'
import { useFilePickerSession } from '@/features/file-picker/state'
import { useDirectoryLoad } from '@/features/file-picker/use-directory-load'
import { useRecentEntries } from '@/features/file-picker/use-recent-entries'
import { useRecordRecentMutation } from '@/features/file-picker/use-record-recent-mutation'
import { useServerInfoForOpen } from '@/features/file-picker/use-server-info-for-open'
import {
  isGoToFolderShortcut,
  isGoUpShortcut,
  isPrintablePickerKey,
  isToggleHiddenShortcut,
} from '@/features/file-picker/utils/keyboard'
import {
  sortFilePickerEntries,
  type FileListSort,
  type FileListSortKey,
} from '@/features/file-picker/utils/sort-entries'
import { useSettingValue } from '@/features/settings/hooks/use-setting-value'
import { useSettingsProjection } from '@/features/settings/hooks/use-settings-projection'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'

type FilePickerDialogProps = {
  accept?: readonly string[]
  iconMode?: FilePickerIconMode
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
  iconMode,
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
  const [sort, setSort] = useState<FileListSort | null>(null)
  const {
    refresh: refreshServerInfo,
    serverInfo,
    serverInfoError,
  } = useServerInfoForOpen(open, session.initializeOpenSession, session.resetOpenSession)
  const recordRecentMutation = useRecordRecentMutation()
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
  const { loadState: recentState, refresh: refreshRecents } = useRecentEntries({
    mode,
    open,
    serverInfo,
    showHidden,
  })
  const { beginDirectoryIntent, loadDirectory, preloadDirectory } = useDirectoryTransition({
    currentPath: session.currentPath,
    enabled: open && session.isInitialized && Boolean(serverInfo),
    mode,
    showHidden,
  })
  const navigateSessionTo = session.navigateTo
  const selectSessionEntry = session.setSelectedEntry
  const loadAndNavigate = useCallback(
    (path: string, intentId: number) => {
      void loadDirectory(path, intentId).then((loaded) => {
        if (loaded) navigateSessionTo(path)
      })
    },
    [loadDirectory, navigateSessionTo],
  )
  const navigateTo = useCallback(
    (path: string) => {
      loadAndNavigate(path, beginDirectoryIntent())
    },
    [beginDirectoryIntent, loadAndNavigate],
  )
  const revealEntry = useCallback(
    (entry: FsEntry) => {
      const path = isDirectoryEntry(entry) ? entry.path : parentPath(entry.path)
      const intentId = beginDirectoryIntent()
      void loadDirectory(path, intentId).then((loaded) => {
        if (!loaded) return

        navigateSessionTo(path)
        if (!isDirectoryEntry(entry)) selectSessionEntry(entry)
      })
    },
    [beginDirectoryIntent, loadDirectory, navigateSessionTo, selectSessionEntry],
  )
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
  // Selection changes frequently; keep them from re-sorting and rebuilding
  // every virtual row when the loaded data and requested order are unchanged.
  const entries = useMemo(
    () => (effectiveSort ? sortFilePickerEntries(loadedEntries, effectiveSort) : loadedEntries),
    [effectiveSort, loadedEntries],
  )
  const selectedEntry = selectedVisibleEntry(entries, session.selectedEntry)
  const isSearchPending = session.query.trim() !== session.effectiveQuery.trim()
  const isSearchLoading = isSearching && isDirectoryFetching
  const listInteractionPending = isSearchPending || isSearchLoading
  const previewEntry = selectedEntry ?? currentEntry
  const selectedPickable =
    toPickedEntry(selectedEntry, mode, accept) ?? currentPickableEntry(currentEntry, mode)
  const homePath = serverInfo?.homePath ?? ROOT_PATH
  const settingsLayers = settings?.layers ?? []
  const hiddenWriteTarget = deriveWriteTarget('files.showHidden', settingsLayers)
  const hiddenManagedByPolicy = policyControlledIds(settingsLayers).includes('files.showHidden')
  const hiddenSettingDisabled = !settings || hiddenManagedByPolicy
  const copy = pickerCopy(mode)
  const displayedIconMode = iconMode ?? (mode === 'file' ? 'vscode' : 'default')
  // The list rows consume these actions through context, so identity must stay
  // stable while typing or scrolling to avoid rerendering every visible row.
  const sessionActions = useMemo<FilePickerSessionActions>(
    () => ({
      jumpTo: navigateTo,
      navigateTo,
      revealEntry,
      selectEntry: session.setSelectedEntry,
    }),
    [navigateTo, revealEntry, session.setSelectedEntry],
  )

  useEffect(() => {
    if (open) commitStartedRef.current = false
  }, [open])

  useEffect(() => {
    if (!selectedEntry || !isDirectoryEntry(selectedEntry)) return

    void preloadDirectory(selectedEntry.path)
  }, [preloadDirectory, selectedEntry])

  function refresh() {
    void Promise.all([refreshDirectory(), refreshRecents(), refreshServerInfo()])
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

  function handleListKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    context: FileListKeyboardContext,
  ) {
    if (isPrintablePickerKey(event)) {
      forwardPrintableKeyToSearch(event)
      return
    }
    if (listInteractionPending) {
      event.preventDefault()
      return
    }
    if (isGoUpShortcut(event)) return leaveDirectory(event)
    if (event.key === 'ArrowDown') return selectByOffset(event, 1)
    if (event.key === 'ArrowUp') return selectByOffset(event, -1)
    if (event.key === 'Home') return selectBoundary(event, 'first')
    if (event.key === 'End') return selectBoundary(event, 'last')
    if (event.key === 'PageDown') return selectByOffset(event, context.pageSize)
    if (event.key === 'PageUp') return selectByOffset(event, -context.pageSize)
    if (event.key === 'Enter') return commitFromKeyboard(event)
    if (event.key === 'ArrowRight') return enterDirectory(event)
    if (event.key === 'ArrowLeft' || event.key === 'Backspace') return leaveDirectory(event)
  }

  function handleDialogKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
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

  function focusListFromSearch(event: KeyboardEvent<HTMLInputElement>, offset: number) {
    event.preventDefault()
    listRef.current?.focus()
    if (listInteractionPending) return

    selectByOffset(event, offset)
  }

  function selectByOffset(event: KeyboardEvent<HTMLElement>, offset: number) {
    event.preventDefault()
    const nextEntry = entryByOffset(entries, selectedEntry, offset)
    if (!nextEntry) return

    session.setSelectedEntry(nextEntry)
  }

  function selectBoundary(event: KeyboardEvent<HTMLElement>, edge: 'first' | 'last') {
    event.preventDefault()
    const nextEntry = edge === 'first' ? entries[0] : entries.at(-1)
    if (!nextEntry) return

    session.setSelectedEntry(nextEntry)
  }

  function commitFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (listInteractionPending) {
      event.preventDefault()
      return
    }

    const candidate = selectedEntry ?? entries[0] ?? null
    if (candidate && isDirectoryEntry(candidate) && mode === 'file') {
      event.preventDefault()
      navigateTo(candidate.path)
      return
    }

    const candidatePickable = candidate ? toPickedEntry(candidate, mode, accept) : selectedPickable
    if (!candidatePickable) return

    event.preventDefault()
    commitPick(candidatePickable)
  }

  function enterDirectory(event: KeyboardEvent<HTMLElement>) {
    if (!selectedEntry || !isDirectoryEntry(selectedEntry)) return

    event.preventDefault()
    navigateTo(selectedEntry.path)
  }

  function leaveDirectory(event: KeyboardEvent<HTMLElement>) {
    if (!session.canGoUp) return

    event.preventDefault()
    navigateTo(parentPath(session.currentPath))
  }

  function forwardPrintableKeyToSearch(event: KeyboardEvent<HTMLElement>) {
    event.preventDefault()
    if (!session.query.trim()) setSort(null)
    session.setSelectedEntry(null)
    session.setQuery(`${session.query}${event.key}`)
    searchInputRef.current?.focus()
  }

  function handleEntryDoubleClick(entry: FsEntry) {
    if (listInteractionPending) return
    if (isDirectoryEntry(entry)) {
      navigateTo(entry.path)
      return
    }

    const picked = toPickedEntry(entry, mode, accept)
    if (!picked) return

    commitPick(picked)
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

  function toggleHiddenFiles() {
    if (hiddenSettingDisabled) return

    settingsActions.setSetting('files.showHidden', !showHidden, hiddenWriteTarget)
  }

  function chooseSelected() {
    if (!selectedPickable) return

    commitPick(selectedPickable)
  }

  function commitPick(entry: PickedFsEntry) {
    if (commitStartedRef.current) return

    commitStartedRef.current = true
    recordRecentMutation.mutate(entry)
    onPick(entry)
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className='bg-popover-solid flex h-[min(760px,calc(100svh-2rem))] w-[min(1080px,calc(100vw-1.5rem))] max-w-none flex-col gap-0 overflow-hidden border p-0 text-sm sm:max-w-none'
        onKeyDownCapture={handleDialogKeyDownCapture}
        showCloseButton={false}
      >
        <FilePickerSessionActionsContext value={sessionActions}>
          {/* Named for assistive tech only. On screen the dialog is its own label:
              the breadcrumb says where you are and the commit button says what
              will happen, so a title bar repeating both is chrome for nothing. */}
          <DialogHeader className='sr-only'>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{`Browsing ${displayPath(session.currentPath)}.`}</DialogDescription>
          </DialogHeader>

          <PaneBar border='bottom'>
            <div
              aria-label='Folder history'
              className='flex shrink-0 items-center gap-0.5'
              role='group'
            >
              <IconTooltip label='Back'>
                <Button
                  aria-label='Back'
                  disabled={!session.canGoBack}
                  onClick={goBack}
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <ArrowLeftIcon />
                </Button>
              </IconTooltip>
              <IconTooltip label='Forward'>
                <Button
                  aria-label='Forward'
                  disabled={!session.canGoForward}
                  onClick={goForward}
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <ArrowRightIcon />
                </Button>
              </IconTooltip>
              <IconTooltip label='Up one folder (⌘↑)'>
                <Button
                  aria-keyshortcuts='Meta+ArrowUp'
                  aria-label='Up one folder'
                  disabled={!session.canGoUp}
                  onClick={() => navigateTo(parentPath(session.currentPath))}
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
            <div className='relative w-52 shrink-0 max-sm:w-32'>
              <MagnifyingGlassIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2' />
              <Input
                ref={searchInputRef}
                aria-label={copy.searchLabel}
                autoFocus
                className='h-(--density-control-height-sm) pl-7 text-xs'
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                placeholder={copy.searchPlaceholder}
                value={session.query}
              />
            </div>
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
              <NewFolderPopover currentPath={session.currentPath} onCreated={handleFolderCreated} />
              <IconTooltip
                label={showHidden ? 'Hide hidden files (⌘⇧.)' : 'Show hidden files (⌘⇧.)'}
              >
                <Button
                  aria-keyshortcuts='Meta+Shift+.'
                  aria-label={showHidden ? 'Hide hidden files' : 'Show hidden files'}
                  aria-pressed={showHidden}
                  disabled={hiddenSettingDisabled}
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

          <div className='border-border border-b px-(--bar-padding-x) lg:hidden'>
            <MobileLocations
              currentPath={session.currentPath}
              homePath={homePath}
              recentState={recentState}
            />
          </div>

          <div className='grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[170px_minmax(0,1fr)_240px]'>
            <PlacesSidebar
              currentPath={session.currentPath}
              homePath={homePath}
              recentState={recentState}
            />
            <div className='border-border bg-background grid min-h-0 grid-rows-[auto_minmax(0,1fr)] lg:border-x'>
              <ListHeader
                isLoading={loadState.status === 'loading' || listInteractionPending}
                isSearching={isSearching}
                mode={mode}
                onSort={handleSort}
                sort={effectiveSort}
              />
              <FileList
                accept={accept}
                entries={entries}
                iconMode={displayedIconMode}
                isBusy={listInteractionPending}
                isSearching={isSearching}
                listRef={listRef}
                loadState={loadState}
                mode={mode}
                onDirectoryIntent={preloadDirectory}
                onEntryDoubleClick={handleEntryDoubleClick}
                onKeyDown={handleListKeyDown}
                onRetry={refresh}
                selectedPath={selectedEntry?.path ?? null}
              />
            </div>
            <PreviewPane
              entry={previewEntry}
              iconMode={displayedIconMode}
              isSearching={isSearching}
              mode={mode}
            />
          </div>

          <DialogFooter className='border-border flex h-(--bar-height) shrink-0 flex-row items-center justify-between gap-(--density-control-gap) border-t px-(--bar-padding-x) sm:justify-between'>
            <SelectedSummary entry={selectedPickable} iconMode={displayedIconMode} mode={mode} />
            <div className='flex shrink-0 gap-1.5'>
              <Button onClick={() => onOpenChange(false)} size='sm' type='button' variant='ghost'>
                Cancel
              </Button>
              <Button disabled={!selectedPickable} onClick={chooseSelected} size='sm' type='button'>
                {copy.chooseLabel}
              </Button>
            </div>
          </DialogFooter>
        </FilePickerSessionActionsContext>
      </DialogContent>
    </Dialog>
  )
}

function selectedVisibleEntry(entries: readonly FsEntry[], selected: FsEntry | null) {
  if (!selected) return null

  return entries.find((entry) => entry.path === selected.path) ?? null
}
