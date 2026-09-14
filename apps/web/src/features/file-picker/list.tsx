import { fileListGridClass } from '@/features/file-picker/utils/list-layout'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { useForesight } from '@foresightjs/react'
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  CaretUpDownIcon,
  CaretUpIcon,
  FolderOpenIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { cn } from '@workspace/ui/lib/utils'
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from 'react'

import { EntryIcon } from '@/features/file-picker/entry-ui'
import { ListLoading } from '@/features/file-picker/components/list-loading'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import { useWorkbenchDensity } from '@/features/settings/hooks/use-workbench-density'
import {
  displayPath,
  formatSizeLabel,
  isPickableEntry,
  kindLabel,
  listLabel,
  pickerCopy,
  type EntriesLoadState,
  type FilePickerIconMode,
  type FilePickerMode,
} from '@/features/file-picker/model'
import {
  filePickerDensityMetrics,
  type FilePickerDensity,
  type FilePickerDensityMetrics,
} from '@/features/file-picker/utils/density'
import { fileListAvailabilityLabel } from '@/features/file-picker/utils/availability'
import {
  buildFileListRowMetrics,
  fileListDensityScrollTop,
  fileListOptionId,
  fileListSelectionScrollTop,
  visibleFileListRows,
  type FileListRowMetrics,
  type FileListViewport,
  type FileListVirtualItem,
} from '@/features/file-picker/utils/listbox'
import type {
  FileListSort,
  FileListSortDirection,
  FileListSortKey,
} from '@/features/file-picker/utils/sort-entries'
import { DIRECTORY_QUERY_STALE_MS } from '@/features/file-picker/utils/directory-query'
import { INTENT_PREFETCH_HIT_SLOP_PX } from '@/lib/intent-prefetch-options'

export type FileListKeyboardContext = {
  pageSize: number
}

type SetFileListViewport = Dispatch<SetStateAction<FileListViewport>>
type FileListViewportRef = { current: FileListViewport }

type FileListScrollSnapshot = {
  density: FilePickerDensity
  rowMetrics: FileListRowMetrics
  rows: readonly FileListRow[]
  selectedIndex: number | undefined
}

const INITIAL_VIEWPORT: FileListViewport = { height: 480, top: 0 }
const compactModifiedFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function ListHeader({
  isLoading,
  isSearching,
  mode,
  onSort,
  sort,
}: {
  isLoading: boolean
  isSearching: boolean
  mode: FilePickerMode
  onSort: (key: FileListSortKey) => void
  sort: FileListSort | null
}) {
  const density = useWorkbenchDensity()
  const metrics = filePickerDensityMetrics(density)

  return (
    <div
      aria-label='File list sorting'
      className={cn(
        'border-border text-muted-foreground/70 grid items-center gap-(--density-control-gap) border-b px-(--density-control-padding-x) text-2xs font-medium tracking-normal uppercase',
        fileListGridClass(mode),
      )}
      role='group'
      style={{ height: metrics.headerSize }}
    >
      <SortableColumnHeader
        isLoading={isLoading}
        keyName='name'
        label={isSearching ? 'Matches' : 'Name'}
        onSort={onSort}
        sort={sort}
      />
      {mode === 'file' ? (
        <SortableColumnHeader keyName='kind' label='Kind' onSort={onSort} sort={sort} />
      ) : null}
      <SortableColumnHeader
        className='max-sm:hidden'
        keyName='modified'
        label='Modified'
        onSort={onSort}
        sort={sort}
      />
      <SortableColumnHeader
        align='end'
        className='max-sm:hidden'
        keyName='size'
        label='Size'
        onSort={onSort}
        sort={sort}
      />
    </div>
  )
}

export function FileList({
  accept,
  entries,
  iconMode,
  isBusy,
  isSearching,
  listRef,
  loadState,
  mode,
  onDirectoryIntent,
  onEntryDoubleClick,
  onKeyDown,
  onRetry,
  selectedPath,
}: {
  accept?: readonly string[]
  entries: FsEntry[]
  iconMode: FilePickerIconMode
  isBusy: boolean
  isSearching: boolean
  listRef?: Ref<HTMLDivElement>
  loadState: EntriesLoadState
  mode: FilePickerMode
  onDirectoryIntent: (path: string) => void
  onEntryDoubleClick: (entry: FsEntry) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, context: FileListKeyboardContext) => void
  onRetry: () => void
  selectedPath: string | null
}) {
  const density = useWorkbenchDensity()
  const densityMetrics = filePickerDensityMetrics(density)
  const rows = useMemo(() => fileListRows(entries, isSearching), [entries, isSearching])
  const listboxRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<FileListViewport>(INITIAL_VIEWPORT)
  const scrollSnapshotRef = useRef<FileListScrollSnapshot>(null)
  const listId = useId()
  const statusId = `${listId}-status`
  const [viewport, setViewport] = useState<FileListViewport>(INITIAL_VIEWPORT)
  const rowMetrics = useMemo(() => fileListRowMetrics(rows, densityMetrics), [densityMetrics, rows])
  const selectedIndex = useMemo(
    () => selectedFileListRowIndex(rows, selectedPath),
    [rows, selectedPath],
  )
  const activeDescendant = activeFileListOptionId(rows, selectedIndex, listId)
  const virtualRows = useMemo(
    () => visibleFileListRows(rowMetrics, viewport, selectedIndex),
    [rowMetrics, selectedIndex, viewport],
  )
  const showError = loadState.status === 'error'
  const showLoading = loadState.status === 'loading' && entries.length === 0
  const showEmpty = !showError && !showLoading && entries.length === 0
  const showStatus = showError || showLoading || showEmpty
  // A stable composed ref prevents detaching the dialog's focus target on every scroll render.
  const setListboxRef = useCallback(
    (element: HTMLDivElement | null) => {
      listboxRef.current = element
      assignRef(listRef, element)
    },
    [listRef],
  )

  useLayoutEffect(() => {
    const element = listboxRef.current
    if (!element) return

    return observeFileListViewport(element, setViewport, viewportRef)
  }, [])

  useLayoutEffect(() => {
    const element = listboxRef.current
    const selectedItem = selectedIndex === undefined ? undefined : rowMetrics.items[selectedIndex]
    const previousSnapshot = scrollSnapshotRef.current
    const nextSnapshot = { density, rowMetrics, rows, selectedIndex }
    scrollSnapshotRef.current = nextSnapshot
    if (!element) return

    if (isDensityOnlyFileListChange(previousSnapshot, nextSnapshot)) {
      syncFileListDensityScroll(
        element,
        previousSnapshot.rowMetrics,
        rowMetrics,
        viewportRef.current,
        setViewport,
        viewportRef,
      )
      return
    }

    syncFileListSelectionScroll(element, selectedItem, setViewport, viewportRef)
  }, [density, rowMetrics, rows, selectedIndex])

  return (
    <div className='relative min-h-0 overflow-hidden'>
      <div
        ref={setListboxRef}
        aria-activedescendant={activeDescendant}
        aria-busy={isBusy || loadState.status === 'loading'}
        aria-describedby={showStatus ? statusId : undefined}
        aria-label={listLabel(mode)}
        className='focus-ring-inset absolute inset-0 overflow-auto outline-none'
        onKeyDown={(event) =>
          onKeyDown(event, {
            pageSize: fileListPageSize(
              viewport.height,
              isSearching ? densityMetrics.entryWithPathRowSize : densityMetrics.entryRowSize,
            ),
          })
        }
        onMouseDown={focusFileList}
        onScroll={(event) => updateFileListViewport(event.currentTarget, setViewport, viewportRef)}
        role='listbox'
        tabIndex={0}
      >
        <div className='relative' style={{ height: rowMetrics.totalSize }}>
          {virtualRows.map((virtualRow) => (
            <FileListVirtualRow
              key={virtualRow.key}
              accept={accept}
              iconMode={iconMode}
              isBusy={isBusy}
              listId={listId}
              mode={mode}
              onDirectoryIntent={onDirectoryIntent}
              onEntryDoubleClick={onEntryDoubleClick}
              optionCount={entries.length}
              row={rows[virtualRow.index]}
              selectedPath={selectedPath}
              virtualRow={virtualRow}
            />
          ))}
        </div>
      </div>
      {showError ? (
        <div className='absolute inset-0' id={statusId}>
          <EmptyState
            action={
              <Button onClick={onRetry} size='sm' type='button' variant='outline'>
                <ArrowClockwiseIcon data-icon='inline-start' />
                Retry
              </Button>
            }
            className='h-full'
            description={loadState.message}
            icon={<WarningCircleIcon className='size-8' weight='duotone' />}
            title='Could not load this folder'
            tone='error'
          />
        </div>
      ) : null}
      {showLoading ? (
        <div className='absolute inset-0' id={statusId}>
          <ListLoading mode={mode} />
        </div>
      ) : null}
      {showEmpty ? (
        <div className='absolute inset-0' id={statusId}>
          <EmptyState
            className='h-full'
            description={pickerCopy(mode).emptyDescription}
            icon={<FolderOpenIcon className='size-8' weight='duotone' />}
            title='Nothing here'
          />
        </div>
      ) : null}
    </div>
  )
}

type FileListRow =
  | {
      kind: 'section'
      key: string
      label: string
    }
  | {
      kind: 'entry'
      key: string
      entry: FsEntry
      position: number
      showPath: boolean
    }

function FileListVirtualRow({
  accept,
  iconMode,
  isBusy,
  listId,
  mode,
  onDirectoryIntent,
  onEntryDoubleClick,
  optionCount,
  row,
  selectedPath,
  virtualRow,
}: {
  accept?: readonly string[]
  iconMode: FilePickerIconMode
  isBusy: boolean
  listId: string
  mode: FilePickerMode
  onDirectoryIntent: (path: string) => void
  onEntryDoubleClick: (entry: FsEntry) => void
  optionCount: number
  row: FileListRow | undefined
  selectedPath: string | null
  virtualRow: FileListVirtualItem
}) {
  if (!row) return null

  return (
    <div
      className='absolute inset-x-1.5 top-0'
      style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
    >
      {row.kind === 'section' ? (
        <div
          aria-hidden='true'
          className='text-muted-foreground/70 text-2xs flex h-full items-center px-2 font-medium tracking-normal uppercase'
        >
          {row.label}
        </div>
      ) : (
        <FileRow
          accept={accept}
          entry={row.entry}
          iconMode={iconMode}
          id={fileListOptionId(listId, row.entry.path)}
          isBusy={isBusy}
          mode={mode}
          onDirectoryIntent={onDirectoryIntent}
          onDoubleClick={onEntryDoubleClick}
          position={row.position}
          selected={row.entry.path === selectedPath}
          setSize={optionCount}
          showPath={row.showPath}
        />
      )}
    </div>
  )
}

function FileRow({
  accept,
  entry,
  iconMode,
  id,
  isBusy,
  mode,
  onDirectoryIntent,
  onDoubleClick,
  position,
  selected,
  setSize,
  showPath,
}: {
  accept?: readonly string[]
  entry: FsEntry
  iconMode: FilePickerIconMode
  id: string
  isBusy: boolean
  mode: FilePickerMode
  onDirectoryIntent: (path: string) => void
  onDoubleClick: (entry: FsEntry) => void
  position: number
  selected: boolean
  setSize: number
  showPath: boolean
}) {
  const { selectEntry } = useFilePickerSessionActions()
  const directory = isDirectoryEntry(entry)
  const pickable = isPickableEntry(entry, mode, accept)
  const availabilityLabel = fileListAvailabilityLabel(entry, mode, pickable)
  const { elementRef } = useForesight<HTMLDivElement>({
    callback: signalDirectoryIntent,
    enabled: directory && !isBusy,
    hitSlop: INTENT_PREFETCH_HIT_SLOP_PX,
    meta: { path: entry.path },
    name: `file-picker-directory:${entry.path}`,
    reactivateAfter: DIRECTORY_QUERY_STALE_MS,
  })

  function signalDirectoryIntent() {
    if (!directory || isBusy) return

    return onDirectoryIntent(entry.path)
  }

  function handleClick() {
    if (isBusy) return

    selectEntry(entry)
  }

  function handleDoubleClick() {
    if (isBusy) return

    onDoubleClick(entry)
  }

  return (
    <div
      ref={directory ? elementRef : undefined}
      aria-disabled={isBusy || undefined}
      aria-posinset={position}
      aria-selected={selected}
      aria-setsize={setSize}
      className={cn(
        'grid h-full w-full cursor-default items-center gap-(--density-control-gap) px-2 text-left text-xs',
        fileListGridClass(mode),
        selected && 'bg-row-selected text-foreground',
        !isBusy && !selected && 'hover:bg-row-hover active:bg-row-active',
        isBusy && 'pointer-events-none opacity-60',
        !pickable && !selected && 'text-muted-foreground/65',
      )}
      id={id}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      role='option'
      title={entry.path}
    >
      <div className='flex min-w-0 items-center gap-2'>
        <EntryIcon
          className='size-4 shrink-0'
          entry={entry}
          iconMode={iconMode}
          selected={selected}
        />
        <div className='min-w-0'>
          <div className='truncate'>{entry.name}</div>
          {showPath ? (
            <div className='text-muted-foreground text-2xs truncate'>{displayPath(entry.path)}</div>
          ) : null}
        </div>
      </div>
      {mode === 'file' ? (
        <div className='text-muted-foreground truncate'>{kindLabel(entry)}</div>
      ) : null}
      <div className='text-muted-foreground truncate tabular-nums max-sm:hidden'>
        {formatFileListModified(entry.mtimeMs)}
      </div>
      <div className='text-muted-foreground text-right tabular-nums max-sm:hidden'>
        {fileListSizeLabel(entry)}
      </div>
      {availabilityLabel ? <span className='sr-only'>{availabilityLabel}</span> : null}
    </div>
  )
}

function SortableColumnHeader({
  align = 'start',
  className,
  isLoading = false,
  keyName,
  label,
  onSort,
  sort,
}: {
  align?: 'start' | 'end'
  className?: string
  isLoading?: boolean
  keyName: FileListSortKey
  label: string
  onSort: (key: FileListSortKey) => void
  sort: FileListSort | null
}) {
  const direction = sort?.key === keyName ? sort.direction : undefined

  return (
    <div className={cn('min-w-0', align === 'end' && 'flex justify-end', className)}>
      <Button
        aria-label={sortButtonLabel(keyName, direction)}
        className={cn(
          'text-muted-foreground/70 min-w-0 px-1.5 text-2xs font-medium tracking-normal uppercase',
          align === 'start' && '-ml-1.5',
          align === 'end' && '-mr-1.5',
        )}
        onClick={() => onSort(keyName)}
        size='xs'
        type='button'
        variant='ghost'
      >
        <span className='truncate'>{label}</span>
        {isLoading ? (
          <OrbitLoader className='size-3' label='Loading entries' />
        ) : (
          <SortIndicator direction={direction} />
        )}
      </Button>
    </div>
  )
}

function SortIndicator({ direction }: { direction?: FileListSortDirection }) {
  if (direction === 'ascending') {
    return <CaretUpIcon aria-hidden='true' className='size-3' weight='bold' />
  }
  if (direction === 'descending') {
    return <CaretDownIcon aria-hidden='true' className='size-3' weight='bold' />
  }

  return <CaretUpDownIcon aria-hidden='true' className='size-3 opacity-35' />
}

function fileListRows(entries: FsEntry[], isSearching: boolean): FileListRow[] {
  if (!isSearching || !entries.some(hasSearchScope)) {
    return entries.map((entry, index) => ({
      kind: 'entry',
      key: entry.path,
      entry,
      position: index + 1,
      showPath: false,
    }))
  }

  let position = 0
  return searchResultSections(entries).flatMap((section) => {
    if (section.entries.length === 0) return []

    return [
      {
        kind: 'section' as const,
        key: `section:${section.scope}`,
        label: section.label,
      },
      ...section.entries.map((entry) => {
        position += 1
        return {
          kind: 'entry' as const,
          key: `${section.scope}:${entry.path}`,
          entry,
          position,
          showPath: true,
        }
      }),
    ]
  })
}

function fileListRowMetrics(
  rows: readonly FileListRow[],
  densityMetrics: FilePickerDensityMetrics,
): FileListRowMetrics {
  return buildFileListRowMetrics(
    rows.map((row) => ({
      key: row.key,
      size: fileListRowSize(row, densityMetrics),
    })),
  )
}

function fileListRowSize(row: FileListRow, densityMetrics: FilePickerDensityMetrics) {
  if (row.kind === 'section') return densityMetrics.sectionRowSize

  return row.showPath ? densityMetrics.entryWithPathRowSize : densityMetrics.entryRowSize
}

function selectedFileListRowIndex(rows: readonly FileListRow[], selectedPath: string | null) {
  if (!selectedPath) return undefined

  const index = rows.findIndex((row) => row.kind === 'entry' && row.entry.path === selectedPath)
  if (index < 0) return undefined

  return index
}

function activeFileListOptionId(
  rows: readonly FileListRow[],
  selectedIndex: number | undefined,
  listId: string,
) {
  if (selectedIndex === undefined) return undefined

  const row = rows[selectedIndex]
  if (row?.kind !== 'entry') return undefined

  return fileListOptionId(listId, row.entry.path)
}

function focusFileList(event: MouseEvent<HTMLDivElement>) {
  if (event.button !== 0) return

  event.currentTarget.focus({ preventScroll: true })
}

function observeFileListViewport(
  element: HTMLDivElement,
  setViewport: SetFileListViewport,
  viewportRef: FileListViewportRef,
) {
  updateFileListViewport(element, setViewport, viewportRef)
  if (!('ResizeObserver' in window)) return

  const observer = new ResizeObserver(() =>
    updateFileListViewport(element, setViewport, viewportRef),
  )
  observer.observe(element)

  return () => observer.disconnect()
}

function syncFileListSelectionScroll(
  element: HTMLDivElement,
  item: FileListVirtualItem | undefined,
  setViewport: SetFileListViewport,
  viewportRef: FileListViewportRef,
) {
  const viewport = fileListViewport(element)
  const nextTop = fileListSelectionScrollTop(item, viewport)
  if (nextTop !== viewport.top) element.scrollTop = nextTop

  updateFileListViewport(element, setViewport, viewportRef)
}

function syncFileListDensityScroll(
  element: HTMLDivElement,
  previousMetrics: FileListRowMetrics,
  nextMetrics: FileListRowMetrics,
  previousViewport: FileListViewport,
  setViewport: SetFileListViewport,
  viewportRef: FileListViewportRef,
) {
  const viewport = { height: element.clientHeight, top: previousViewport.top }
  element.scrollTop = fileListDensityScrollTop(previousMetrics, nextMetrics, viewport)
  updateFileListViewport(element, setViewport, viewportRef)
}

function updateFileListViewport(
  element: HTMLDivElement,
  setViewport: SetFileListViewport,
  viewportRef: FileListViewportRef,
) {
  const nextViewport = fileListViewport(element)
  viewportRef.current = nextViewport
  setViewport((currentViewport) => {
    if (sameFileListViewport(currentViewport, nextViewport)) return currentViewport

    return nextViewport
  })
}

function fileListViewport(element: HTMLDivElement): FileListViewport {
  return { height: element.clientHeight, top: element.scrollTop }
}

function sameFileListViewport(first: FileListViewport, second: FileListViewport) {
  return first.height === second.height && first.top === second.top
}

function isDensityOnlyFileListChange(
  previous: FileListScrollSnapshot | null,
  next: FileListScrollSnapshot,
): previous is FileListScrollSnapshot {
  if (!previous) return false
  if (previous.density === next.density) return false
  if (previous.selectedIndex !== next.selectedIndex) return false

  return sameFileListRows(previous.rows, next.rows)
}

function sameFileListRows(first: readonly FileListRow[], second: readonly FileListRow[]) {
  if (first.length !== second.length) return false

  for (let index = 0; index < first.length; index += 1) {
    if (first[index]?.key !== second[index]?.key) return false
  }

  return true
}

function fileListPageSize(viewportHeight: number, rowSize: number) {
  return Math.max(1, Math.floor(viewportHeight / rowSize))
}

function formatFileListModified(mtimeMs: number) {
  if (mtimeMs <= 0) return 'Unknown'

  return compactModifiedFormatter.format(new Date(mtimeMs))
}

function fileListSizeLabel(entry: FsEntry) {
  if (isDirectoryEntry(entry)) return '--'

  return formatSizeLabel(entry)
}

function sortButtonLabel(key: FileListSortKey, direction?: FileListSortDirection) {
  if (!direction) return `Sort by ${key}`

  return `Sort by ${key}, currently ${direction}`
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }

  ref.current = value
}

function hasSearchScope(entry: FsEntry) {
  return entry.searchScope === 'current' || entry.searchScope === 'system'
}

function searchResultSections(entries: FsEntry[]) {
  return [
    {
      scope: 'current' as const,
      label: 'Current folder',
      entries: entries.filter((entry) => entry.searchScope === 'current'),
    },
    {
      scope: 'system' as const,
      label: 'System-wide',
      entries: entries.filter((entry) => entry.searchScope === 'system'),
    },
  ]
}
