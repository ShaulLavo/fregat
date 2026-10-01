import { useEffect, useRef, useState } from 'react'
import { Textarea } from '@workspace/ui/components/textarea'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { CsvMove } from '@/features/workbench/utils/csv-navigation'
import type { CsvCell } from '@/features/workbench/utils/csv'

export function CsvCellInput({
  cell,
  row,
  column,
  editable,
  width,
  onEdit,
  active,
  onSelect,
  onNavigate,
}: {
  readonly cell: CsvCell
  readonly row: number
  readonly column: number
  readonly editable: boolean
  readonly width: number
  readonly active: boolean
  readonly onSelect: () => void
  readonly onNavigate: (move: CsvMove) => void
  readonly onEdit: (cell: CsvCell, value: string) => void
}) {
  const [draft, setDraft] = useState<{ value: string; cell: CsvCell } | null>(null)
  const host = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (draft !== null || !restoreFocus.current) return
    restoreFocus.current = false
    host.current?.querySelector('button')?.focus()
  }, [draft])
  const label = `Row ${row + 1}, column ${column + 1}`
  const numeric = cell.value.trim() !== '' && Number.isFinite(Number(cell.value))

  function finish(move: CsvMove | null) {
    if (
      draft !== null &&
      draft.cell.start === cell.start &&
      draft.cell.end === cell.end &&
      draft.cell.value === cell.value
    )
      onEdit(cell, draft.value)
    setDraft(null)
    if (move) onNavigate(move)
  }

  return (
    <div ref={host} role='cell' className='relative shrink-0' style={{ width }}>
      {draft === null ? (
        <ListRow
          as='button'
          aria-label={label}
          title={cell.value}
          data-csv-cell={`${row}:${column}`}
          tabIndex={active ? 0 : -1}
          onFocus={onSelect}
          className='focus-ring-inset w-full font-mono tabular-nums'
          onDoubleClick={() => {
            if (editable) setDraft({ value: cell.value, cell })
          }}
          onKeyDown={(event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return
            const directions: Record<string, CsvMove> = {
              ArrowLeft: 'left',
              ArrowRight: 'right',
              ArrowUp: 'up',
              ArrowDown: 'down',
              Home: 'first',
              End: 'last',
            }
            const direction = directions[event.key]
            if (direction) {
              event.preventDefault()
              onNavigate(direction)
              return
            }
            if (!editable) return
            if (event.key === 'Enter') {
              event.preventDefault()
              setDraft({ value: cell.value, cell })
              return
            }
            if (event.key.length === 1) {
              event.preventDefault()
              setDraft({ value: event.key, cell })
            }
          }}
        >
          <span
            className={numeric ? 'min-w-0 flex-1 truncate text-right' : 'min-w-0 flex-1 truncate'}
            title={cell.value}
          >
            {cell.value.replaceAll(/\r?\n/gu, ' ')}
          </span>
        </ListRow>
      ) : (
        <Textarea
          autoFocus
          aria-label={label}
          data-csv-cell={`${row}:${column}`}
          className='relative z-10 resize-none font-mono'
          title={cell.value}
          value={draft.value}
          rows={cell.value.includes('\n') ? 3 : 1}
          onChange={(event) => setDraft({ value: event.currentTarget.value, cell: draft.cell })}
          onBlur={() => finish(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              restoreFocus.current = true
              setDraft(null)
              return
            }
            if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
              event.preventDefault()
              let move: 'down' | 'previous' | 'next' = event.shiftKey ? 'previous' : 'next'
              if (event.key === 'Enter') move = 'down'
              finish(move)
            }
          }}
        />
      )}
    </div>
  )
}
