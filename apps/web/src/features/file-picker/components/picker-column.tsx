import { useQuery } from '@tanstack/react-query'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from 'react'

import type { FsEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { ColumnLoading } from '@/features/file-picker/components/column-loading'
import { ColumnRow } from '@/features/file-picker/components/column-row'
import { directoryQueryOptions } from '@/features/file-picker/utils/directory-query'
import type { FilePickerMode } from '@/features/file-picker/utils/model'
import { filterPickerEntries } from '@/features/file-picker/utils/type-filter'
import { sortFilePickerEntries } from '@/features/file-picker/utils/sort-entries'
import { folderLabel } from '@/features/file-picker/utils/columns'
import { WidthHandle } from '@workspace/ui/patterns/width-handle'
import { useElementWidth } from '@/hooks/use-element-width'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import {
  COLUMN_MAX_WIDTH_PX,
  COLUMN_MIN_WIDTH_PX,
} from '@/features/file-picker/utils/column-widths'
import { fitColumnWidth } from '@/features/file-picker/utils/fit-column'

const BY_NAME = { direction: 'ascending', key: 'name' } as const

/**
 * One folder of the columns view. ↑↓ move within it, → steps into the selected folder's column
 * and ← back out; only the column holding focus is a tab stop.
 */
export function PickerColumn({
  accept,
  active,
  column,
  isBusy,
  mode,
  path,
  selectFirst,
  selectedPath,
  showHidden,
  width,
  onActivate,
  onCommit,
  onDirectoryIntent,
  onEnter,
  onLeave,
  onOpen,
  onSelect,
}: {
  accept?: readonly string[]
  active: boolean
  column: number
  isBusy: boolean
  mode: FilePickerMode
  path: string
  /** Entered with →: select the first entry once the folder has loaded. */
  selectFirst: boolean
  selectedPath: string | null
  showHidden: boolean
  /** Pixels the user dragged this depth to; null is the default width. */
  width: number | null
  onActivate: (column: number) => void
  onCommit: (entry: FsEntry) => void
  onDirectoryIntent: (path: string) => void
  onEnter: (column: number) => void
  onLeave: (column: number) => void
  onOpen: (entry: FsEntry) => void
  onSelect: (column: number, entry: FsEntry) => void
}) {
  const query = useQuery(directoryQueryOptions({ mode, path, query: '', showHidden }))
  const entries = sortFilePickerEntries(
    filterPickerEntries(query.data?.entries ?? [], mode, accept),
    BY_NAME,
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const [columnRef, measuredWidth] = useElementWidth<HTMLDivElement>()
  const { resizeColumn } = useFilePickerSessionActions()
  const virtualRef = useRef<VirtualListHandle>(null)
  const find = (id: string) => entries.find((entry) => entry.path === id)
  const list = useListbox({
    role: 'listbox',
    containerRef,
    items: entries.map((entry) => ({ id: entry.path, label: entry.name, disabled: isBusy })),
    activeId: selectedPath,
    onActiveChange(id) {
      const entry = find(id)
      if (entry) onSelect(column, entry)
    },
    onCommit(id) {
      const entry = find(id)
      if (entry) onCommit(entry)
    },
    onSelect() {},
    typeahead: true,
    revealOnMount: false,
    scrollToIndex: (index) => virtualRef.current?.scrollToIndex(index, { align: 'auto' }),
    onActiveKeyDown(event, id) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const entry = find(id)
      if (event.key !== 'ArrowRight' || !entry || !isDirectoryEntry(entry)) return
      event.preventDefault()
      onEnter(column)
    },
  })
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.key === 'ArrowLeft' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault()
      onLeave(column)
      return
    }
    list.containerProps.onKeyDown(event)
  }
  const first = entries[0]

  const selectFirstEntry = useEffectEvent((entry: FsEntry) => onSelect(column, entry))
  useEffect(() => {
    if (selectFirst && selectedPath === null && first) selectFirstEntry(first)
  }, [first, selectFirst, selectedPath])

  function fitToNames() {
    const scroller = containerRef.current
    const fitted = scroller
      ? fitColumnWidth(
          scroller,
          entries.map((entry) => entry.name),
        )
      : null
    if (fitted !== null) resizeColumn(column, fitted)
  }

  return (
    <div
      className='relative flex h-full w-(--picker-column-width) shrink-0 flex-col'
      data-picker-column-folder={path}
      ref={columnRef}
      style={width === null ? undefined : { width }}
    >
      {query.isPending ? <ColumnLoading /> : null}
      {query.isError ? (
        <EmptyState className='h-full' title='Could not load this folder' tone='error' />
      ) : null}
      {query.isSuccess && entries.length === 0 ? (
        <EmptyState className='h-full' title='Empty folder' />
      ) : null}
      <VirtualList
        {...list.containerProps}
        activeIndex={list.activeIndex}
        aria-label={`${folderLabel(path)} folder`}
        className='focus-ring-inset absolute inset-0 outline-none'
        data-picker-column={column}
        getKey={(entry) => entry.path}
        handleRef={virtualRef}
        items={entries}
        renderRow={(entry) => (
          <ColumnRow
            accept={accept}
            entry={entry}
            isBusy={isBusy}
            mode={mode}
            rowProps={list.rowProps(entry.path)}
            selected={entry.path === selectedPath}
            onDirectoryIntent={onDirectoryIntent}
            onDoubleClick={onOpen}
          />
        )}
        scrollRef={containerRef}
        tabIndex={active ? 0 : -1}
        onFocus={() => onActivate(column)}
        onKeyDown={handleKeyDown}
      />
      <WidthHandle
        label={`Resize ${folderLabel(path)} column`}
        max={COLUMN_MAX_WIDTH_PX}
        min={COLUMN_MIN_WIDTH_PX}
        width={width ?? measuredWidth ?? 0}
        onFit={fitToNames}
        onResize={(next) => resizeColumn(column, next)}
      />
    </div>
  )
}
