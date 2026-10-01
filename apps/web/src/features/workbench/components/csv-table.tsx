import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { VirtualList, type VirtualListHandle } from '@workspace/ui/patterns/virtual-list'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { useRowHeight } from '@workspace/ui/patterns/use-row-height'
import type { EditorTextBuffer, EditorViewSession } from '@singapore-editor/core/document'
import { CsvCellInput } from '@/features/workbench/components/csv-cell'
import { useCsvPresentation } from '@/features/workbench/state/csv-presentation'
import type { TabId } from '@/lib/documents/utils/types'
import {
  nextCsvPosition,
  type CsvMove,
  type CsvPosition,
} from '@/features/workbench/utils/csv-navigation'
import type { CsvCell } from '@/features/workbench/utils/csv'
import type { CsvEngine } from '@/features/workbench/utils/csv-engine'

export function CsvTable({
  buffer,
  view,
  editable,
  engine,
  tabId,
}: {
  readonly buffer: EditorTextBuffer
  readonly view: EditorViewSession
  readonly editable: boolean
  readonly tabId: TabId
  readonly engine: CsvEngine
}) {
  // useSyncExternalStore retains this subscription while the buffer identity is unchanged.
  const subscribe = useCallback((listener: () => void) => buffer.subscribe(listener), [buffer])
  const snapshot = useSyncExternalStore(subscribe, () => buffer.getTextSnapshot())
  const presentation = engine.parseCsv(snapshot.readRange(0, snapshot.length))
  const [cursor, setCursor] = useState<CsvPosition>({ row: 0, column: 0 })
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const headerHeight = useRowHeight(host)
  const virtualList = useRef<VirtualListHandle>(null)
  const pendingFocus = useRef(false)
  const header = useCsvPresentation((state) => state.tabs[tabId]?.header ?? false)

  function edit(cell: CsvCell, value: string) {
    if (!editable || snapshot !== buffer.getTextSnapshot()) return
    const replacement = engine.csvCellEdit(
      cell,
      presentation.kind === 'table' ? presentation.table.delimiter : ',',
      value,
    )
    if (replacement) buffer.applyEdits(view.getSelections(), [replacement], {}, view)
  }

  const table = presentation.kind === 'table' ? presentation.table : null
  const rows = header ? table?.rows.slice(1) : table?.rows
  const columns = table?.rows.reduce((count, row) => Math.max(count, row.length), 0) ?? 0
  const headings = header ? table?.rows[0] : null
  const activeRow = Math.min(cursor.row, Math.max(0, (rows?.length ?? 0) - 1))
  const activeColumn = Math.min(cursor.column, Math.max(0, (rows?.[activeRow]?.length ?? 0) - 1))

  // useLayoutEffect and VirtualList's rendered-range effect depend on this identity.
  const focusCursor = useCallback(() => {
    if (!pendingFocus.current) return
    const sourceRow = activeRow + (header ? 1 : 0)
    const control = host.current?.querySelector<HTMLElement>(
      `button[data-csv-cell="${sourceRow}:${activeColumn}"]`,
    )
    if (!control) return
    pendingFocus.current = false
    control.focus({ preventScroll: true })
    const scrollHost = scroller.current
    if (!scrollHost) return
    const viewport = scrollHost.getBoundingClientRect()
    const cell = control.getBoundingClientRect()
    const right = viewport.left + scrollHost.clientWidth
    if (cell.left < viewport.left) scrollHost.scrollLeft += cell.left - viewport.left
    else if (cell.right > right) scrollHost.scrollLeft += cell.right - right
  }, [activeRow, activeColumn, header])

  function move(from: CsvPosition, direction: CsvMove) {
    const next = nextCsvPosition(rows ?? [], from, direction)
    pendingFocus.current = true
    virtualList.current?.scrollToIndex(next.row, { align: 'auto' })
    setCursor(next)
  }

  // A final-cell commit restores focus even when the destination coordinates stay unchanged.
  useLayoutEffect(() => focusCursor())

  const widths = Array.from({ length: columns }, (_, column) => {
    const longest =
      table?.rows.reduce((length, row) => Math.max(length, row[column]?.value.length ?? 0), 8) ?? 8
    return Math.min(320, Math.max(96, longest * 8 + 24))
  })

  return (
    <ToolPane
      title='CSV table'
      header={null}
      aria-label='CSV table'
      data-csv-table=''
      scroll={false}
      state={{ error: presentation.kind === 'error', empty: rows?.length === 0 }}
      errorState={
        <EmptyState
          title='CSV could not be read'
          description={presentation.kind === 'error' ? presentation.message : undefined}
        />
      }
      emptyState={<EmptyState title='No CSV rows' />}
    >
      <div ref={host} role='table' aria-label='CSV rows' className='flex h-full min-h-0 flex-col'>
        <VirtualList
          activeIndex={activeRow}
          handleRef={virtualList}
          scrollRef={scroller}
          onItemsRendered={focusCursor}
          items={rows ?? []}
          getKey={(_, index) => index}
          scrollMargin={headerHeight}
          scrollPaddingStart={headerHeight}
          contentClassName='w-max min-w-full'
          measureItems
          fade={false}
          renderLayout={({ content, scrollRef }) => (
            <div
              ref={scrollRef}
              data-slot='virtual-list'
              className='scroll-gutter relative min-h-0 flex-1 overflow-auto'
            >
              <div
                style={{ width: widths.reduce((sum, width) => sum + width, 0), minWidth: '100%' }}
              >
                <div role='row' className='bg-muted-solid sticky top-0 z-10 flex w-max min-w-full'>
                  {Array.from({ length: columns }, (_, column) => {
                    const label = headings?.[column]?.value ?? `Column ${column + 1}`
                    return (
                      <div
                        key={column}
                        role='columnheader'
                        title={label}
                        style={{ width: widths[column] }}
                        className='text-muted-foreground h-(--density-row-height) shrink-0 truncate px-(--density-row-padding-x) text-xs font-medium'
                      >
                        {label}
                      </div>
                    )
                  })}
                </div>
                <div role='rowgroup'>{content}</div>
              </div>
            </div>
          )}
          renderRow={(row, index) => (
            <ListRow
              role='row'
              selected={activeRow === index}

              className='bg-content-well w-max min-w-full gap-0 px-0 has-data-[slot=textarea]:h-auto has-data-[slot=textarea]:items-start'
            >
              {row.map((cell, column) => (
                <CsvCellInput
                  key={column}
                  cell={cell}
                  row={index + (header ? 1 : 0)}
                  column={column}
                  editable={editable}
                  width={widths[column]!}
                  active={activeRow === index && activeColumn === column}
                  onSelect={() => setCursor({ row: index, column })}
                  onNavigate={(direction) => move({ row: index, column }, direction)}
                  onEdit={edit}
                />
              ))}
            </ListRow>
          )}
        />
      </div>
    </ToolPane>
  )
}
