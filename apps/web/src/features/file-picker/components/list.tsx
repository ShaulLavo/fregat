import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ArrowClockwiseIcon, FolderOpenIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { ListLoading } from '@/features/file-picker/components/list-loading'
import { FileRow } from '@/features/file-picker/components/file-row'
import { TouchRow } from '@/features/file-picker/components/touch-row'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import { fileListRows, type LeadingRecents } from '@/features/file-picker/utils/rows'
import { SCROLL_INTENT_SETTLE_MS } from '@/features/file-picker/utils/intent'
import { PICKER_COPY, type EntriesLoadState } from '@/features/file-picker/utils/model'

export function FileList({
  entries,
  isBusy,
  isSearching,
  listRef,
  loadState,
  onDirectoryIntent,
  onEntryDoubleClick,
  onCommitEntry,
  onGoParent,
  onRetry,
  recents = null,
  selectedPath,
  touch,
}: {
  entries: FsEntry[]
  isBusy: boolean
  isSearching: boolean
  listRef?: RefObject<HTMLDivElement | null>
  loadState: EntriesLoadState
  onDirectoryIntent: (path: string) => void
  onEntryDoubleClick: (entry: FsEntry) => void
  onCommitEntry: (entry: FsEntry) => void
  onGoParent: () => void
  onRetry: () => void
  /** Recent folders to lead the list with; a tap goes to one wherever it lives. */
  recents?: LeadingRecents | null
  selectedPath: string | null
  /** Finger-sized rows where one tap opens a folder. */
  touch: boolean
}) {
  const internalRef = useRef<HTMLDivElement>(null)
  const containerRef = listRef ?? internalRef
  const virtualRef = useRef<VirtualListHandle>(null)
  const lastScrollAt = useRef(Number.NEGATIVE_INFINITY)
  const statusId = useId()
  const showLoading = loadState.status === 'loading' && entries.length === 0
  // The loading and error overlays are see-through, so no row may sit under them.
  const rows =
    showLoading || loadState.status === 'error' ? [] : fileListRows(entries, isSearching, recents)
  const setSize = rows.filter((row) => row.kind === 'entry').length
  const { revealEntry, selectEntry } = useFilePickerSessionActions()
  // A recent folder can also be listed below it; the row last moved to keeps the highlight.
  const [lastActiveKey, setLastActiveKey] = useState<string | null>(null)
  const selectedRows = rows.filter((row) => row.kind === 'entry' && row.entry.path === selectedPath)
  const activeKey =
    selectedRows.find((row) => row.key === lastActiveKey)?.key ?? selectedRows[0]?.key ?? null
  const list = useListbox({
    role: 'listbox',
    containerRef,
    items: rows.map((row) => ({
      id: row.key,
      label: row.kind === 'entry' ? row.entry.name : '',
      disabled: isBusy || row.kind === 'section',
    })),
    activeId: activeKey,
    onActiveChange(id) {
      const row = rows.find((row) => row.key === id)
      if (row?.kind !== 'entry') return
      setLastActiveKey(row.key)
      selectEntry(row.entry)
    },
    onCommit(id) {
      const row = rows.find((row) => row.key === id)
      if (row?.kind !== 'entry') return
      if (row.recent) return revealEntry(row.entry)
      onCommitEntry(row.entry)
    },
    onSelect() {},
    typeahead: true,
    scrollToIndex: (index) => virtualRef.current?.scrollToIndex(index, { align: 'auto' }),
    onActiveKeyDown(event, id) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const row = rows.find((row) => row.key === id)
      if (event.key !== 'ArrowRight' || row?.kind !== 'entry' || !isDirectoryEntry(row.entry))
        return
      event.preventDefault()
      onEntryDoubleClick(row.entry)
    },
  })
  const showError = !showLoading && loadState.status === 'error'
  // With recent folders above it, an empty folder says so in its section label.
  const showEmpty = !showLoading && !showError && rows.length === 0
  const showStatus = showLoading || showError || showEmpty

  function signalDirectoryIntent(path: string) {
    if (performance.now() - lastScrollAt.current < SCROLL_INTENT_SETTLE_MS) return
    onDirectoryIntent(path)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    list.containerProps.onKeyDown(event)
    if (event.defaultPrevented || event.nativeEvent.isComposing || isBusy) return
    if (event.target !== event.currentTarget) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'Backspace') return
    event.preventDefault()
    onGoParent()
  }

  return (
    <div className='relative min-h-0 overflow-hidden'>
      <VirtualList
        {...list.containerProps}
        onKeyDown={handleKeyDown}
        onScroll={() => {
          lastScrollAt.current = performance.now()
        }}
        activeIndex={list.activeIndex}
        scrollRef={containerRef}
        handleRef={virtualRef}
        items={rows}
        measureItems
        layout='flow'
        getKey={(row) => row.key}
        aria-busy={isBusy || loadState.status === 'loading'}
        aria-describedby={showStatus ? statusId : undefined}
        aria-label={PICKER_COPY.listLabel}
        className='focus-ring-inset absolute inset-0 outline-none'
        renderRow={(row) => {
          if (row.kind === 'section')
            return (
              <div
                aria-hidden='true'
                className='text-muted-foreground section-label flex h-(--density-control-height-sm) items-center px-(--density-row-padding-x)'
              >
                {row.label}
              </div>
            )
          if (touch)
            return (
              <TouchRow
                entry={row.entry}
                isBusy={isBusy}
                onOpen={row.recent ? revealEntry : onEntryDoubleClick}
                position={row.position}
                rowProps={list.rowProps(row.key)}
                selected={row.key === activeKey}
                setSize={setSize}
                showPath={row.showPath}
              />
            )
          return (
            <FileRow
              entry={row.entry}
              rowProps={list.rowProps(row.key)}
              isBusy={isBusy}
              onDirectoryIntent={signalDirectoryIntent}
              onDoubleClick={row.recent ? revealEntry : onEntryDoubleClick}
              position={row.position}
              selected={row.key === activeKey}
              setSize={setSize}
              showPath={row.showPath}
            />
          )
        }}
      />
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
            description={loadState.status === 'error' ? loadState.message : undefined}
            icon={<WarningCircleIcon className='size-(--icon-size)' weight='duotone' />}
            title='Could not load this folder'
            tone='error'
          />
        </div>
      ) : null}
      {showLoading ? (
        <div className='absolute inset-0' id={statusId}>
          <ListLoading />
        </div>
      ) : null}
      {showEmpty ? (
        <div className='absolute inset-0' id={statusId}>
          <EmptyState
            className='h-full'
            description={PICKER_COPY.emptyDescription}
            icon={<FolderOpenIcon className='size-(--icon-size)' weight='duotone' />}
            title='Nothing here'
          />
        </div>
      ) : null}
    </div>
  )
}
