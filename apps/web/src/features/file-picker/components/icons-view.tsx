import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { IconsLoading } from '@/features/file-picker/components/icons-loading'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useRef, type KeyboardEvent, type RefObject } from 'react'

import type { FsEntry } from '@/lib/file-system-types'
import { useElementWidth } from '@/hooks/use-element-width'
import { FileTile } from '@/features/file-picker/components/file-tile'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import { TILE_ROW_PX, tileColumns, tileRows } from '@/features/file-picker/utils/tiles'
import {
  listLabel,
  pickerCopy,
  type EntriesLoadState,
  type FilePickerIconMode,
  type FilePickerMode,
} from '@/features/file-picker/utils/model'

/**
 * The folder as a grid of tiles, for image and asset folders. The listbox moves by whole rows
 * with ↑↓ and by one tile with ←→; the list windows over rows of tiles sized to the width.
 */
export function IconsView({
  entries,
  iconMode,
  isBusy,
  listRef,
  loadState,
  mode,
  selectedPath,
  onCommitEntry,
  onEntryDoubleClick,
  onGoParent,
  onRetry,
}: {
  entries: readonly FsEntry[]
  iconMode: FilePickerIconMode
  isBusy: boolean
  listRef: RefObject<HTMLDivElement | null>
  loadState: EntriesLoadState
  mode: FilePickerMode
  selectedPath: string | null
  onCommitEntry: (entry: FsEntry) => void
  onEntryDoubleClick: (entry: FsEntry) => void
  onGoParent: () => void
  onRetry: () => void
}) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>()
  const virtualRef = useRef<VirtualListHandle>(null)
  const columns = tileColumns(width)
  const rows = tileRows(entries, columns)
  const { selectEntry } = useFilePickerSessionActions()
  const find = (id: string) => entries.find((entry) => entry.path === id)
  const list = useListbox({
    role: 'listbox',
    containerRef: listRef,
    columns,
    items: entries.map((entry) => ({ id: entry.path, label: entry.name, disabled: isBusy })),
    activeId: selectedPath,
    onActiveChange(id) {
      const entry = find(id)
      if (entry) selectEntry(entry)
    },
    onCommit(id) {
      const entry = find(id)
      if (entry) onCommitEntry(entry)
    },
    onSelect() {},
    typeahead: true,
    scrollToIndex: (index) =>
      virtualRef.current?.scrollToIndex(Math.floor(index / columns), { align: 'auto' }),
  })

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    list.containerProps.onKeyDown(event)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== 'Backspace') return
    event.preventDefault()
    onGoParent()
  }

  return (
    <div className='relative h-full min-h-0' ref={measureRef}>
      <VirtualList
        {...list.containerProps}
        activeIndex={list.activeIndex < 0 ? undefined : Math.floor(list.activeIndex / columns)}
        aria-label={listLabel(mode)}
        aria-busy={isBusy || loadState.status === 'loading'}
        className='focus-ring-inset absolute inset-0 outline-none'
        estimateSize={() => TILE_ROW_PX}
        getKey={(row) => row[0]?.path ?? ''}
        handleRef={virtualRef}
        items={rows}
        renderRow={(row) => (
          <div className='flex gap-1 px-2'>
            {row.map((entry) => (
              <FileTile
                entry={entry}
                iconMode={iconMode}
                isBusy={isBusy}
                key={entry.path}
                rowProps={list.rowProps(entry.path)}
                selected={entry.path === selectedPath}
                onDoubleClick={onEntryDoubleClick}
              />
            ))}
          </div>
        )}
        scrollRef={listRef}
        onKeyDown={handleKeyDown}
      />
      {loadState.status === 'loading' && entries.length === 0 ? (
        <IconsLoading columns={columns} />
      ) : null}
      {loadState.status === 'error' ? (
        <EmptyState
          action={
            <Button onClick={onRetry} size='sm' type='button' variant='outline'>
              Retry
            </Button>
          }
          className='absolute inset-0'
          description={loadState.message}
          title='Could not load this folder'
          tone='error'
        />
      ) : null}
      {loadState.status === 'ready' && entries.length === 0 ? (
        <EmptyState
          className='absolute inset-0'
          description={pickerCopy(mode).emptyDescription}
          title='Nothing here'
        />
      ) : null}
    </div>
  )
}
