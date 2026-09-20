import { useId, useRef, type RefObject } from 'react'
import { ArrowClockwiseIcon, FolderOpenIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { ListLoading } from '@/features/file-picker/components/list-loading'
import { FileRow } from '@/features/file-picker/components/file-row'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import { fileListRows } from '@/features/file-picker/utils/rows'
import {
  listLabel,
  pickerCopy,
  type EntriesLoadState,
  type FilePickerIconMode,
  type FilePickerMode,
} from '@/features/file-picker/utils/model'

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
  onCommitEntry,
  onGoParent,
  onRetry,
  selectedPath,
}: {
  accept?: readonly string[]
  entries: FsEntry[]
  iconMode: FilePickerIconMode
  isBusy: boolean
  isSearching: boolean
  listRef?: RefObject<HTMLDivElement | null>
  loadState: EntriesLoadState
  mode: FilePickerMode
  onDirectoryIntent: (path: string) => void
  onEntryDoubleClick: (entry: FsEntry) => void
  onCommitEntry: (entry: FsEntry) => void
  onGoParent: () => void
  onRetry: () => void
  selectedPath: string | null
}) {
  const internalRef = useRef<HTMLDivElement>(null)
  const containerRef = listRef ?? internalRef
  const virtualRef = useRef<VirtualListHandle>(null)
  const statusId = useId()
  const rows = fileListRows(entries, isSearching)
  const { selectEntry } = useFilePickerSessionActions()
  const list = useListbox({
    role: 'listbox',
    containerRef,
    items: rows.map((row) => ({
      id: row.key,
      label: row.kind === 'entry' ? row.entry.name : '',
      disabled: isBusy || row.kind === 'section',
    })),
    activeId:
      rows.find((row) => row.kind === 'entry' && row.entry.path === selectedPath)?.key ?? null,
    onActiveChange(id) {
      const row = rows.find((row) => row.key === id)
      if (row?.kind === 'entry') selectEntry(row.entry)
    },
    onCommit(id) {
      const row = rows.find((row) => row.key === id)
      if (row?.kind === 'entry') onCommitEntry(row.entry)
    },
    onSelect() {},
    typeahead: true,
    scrollToIndex: (index) => virtualRef.current?.scrollToIndex(index, { align: 'auto' }),
    onActiveKeyDown(event, id) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
        event.preventDefault()
        onGoParent()
        return
      }
      const row = rows.find((row) => row.key === id)
      if (event.key !== 'ArrowRight' || row?.kind !== 'entry' || !isDirectoryEntry(row.entry))
        return
      event.preventDefault()
      onEntryDoubleClick(row.entry)
    },
  })
  const showLoading = loadState.status === 'loading' && entries.length === 0
  const showError = !showLoading && loadState.status === 'error'
  const showEmpty = !showLoading && !showError && entries.length === 0
  const showStatus = showLoading || showError || showEmpty

  return (
    <div className='relative min-h-0 overflow-hidden'>
      <VirtualList
        {...list.containerProps}
        activeIndex={list.activeIndex}
        scrollRef={containerRef}
        handleRef={virtualRef}
        items={rows}
        measureItems
        layout='flow'
        getKey={(row) => row.key}
        aria-busy={isBusy || loadState.status === 'loading'}
        aria-describedby={showStatus ? statusId : undefined}
        aria-label={listLabel(mode)}
        className='focus-ring-inset absolute inset-0 outline-none'
        renderRow={(row) =>
          row.kind === 'section' ? (
            <div
              aria-hidden='true'
              className='text-muted-foreground text-2xs flex h-(--density-control-height-sm) items-center px-(--density-row-padding-x) font-medium tracking-wider uppercase'
            >
              {row.label}
            </div>
          ) : (
            <FileRow
              accept={accept}
              entry={row.entry}
              iconMode={iconMode}
              rowProps={list.rowProps(row.key)}
              isBusy={isBusy}
              mode={mode}
              onDirectoryIntent={onDirectoryIntent}
              onDoubleClick={onEntryDoubleClick}
              position={row.position}
              selected={row.entry.path === selectedPath}
              setSize={entries.length}
              showPath={row.showPath}
            />
          )
        }
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
          <ListLoading mode={mode} />
        </div>
      ) : null}
      {showEmpty ? (
        <div className='absolute inset-0' id={statusId}>
          <EmptyState
            className='h-full'
            description={pickerCopy(mode).emptyDescription}
            icon={<FolderOpenIcon className='size-(--icon-size)' weight='duotone' />}
            title='Nothing here'
          />
        </div>
      ) : null}
    </div>
  )
}
