import { EmptyState } from '@workspace/ui/components/empty-state'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { useEffect, useState } from 'react'

import { BreadcrumbSymbolRows } from '@/features/workbench/components/breadcrumb-symbol-rows'
import {
  symbolPickerRows,
  togglePickerBranch,
} from '@/features/workbench/utils/breadcrumb-picker-rows'
import { symbolRowKey } from '@/features/workbench/utils/breadcrumbs'
import type { DocumentSymbol } from '@/lib/document-symbols'

export function BreadcrumbSymbolPicker({
  chain,
  symbols,
  onPick,
}: {
  readonly chain: readonly DocumentSymbol[]
  readonly symbols: readonly DocumentSymbol[]
  readonly onPick: (symbol: DocumentSymbol) => void
}) {
  const selected = chain.at(-1)
  const [activeId, setActiveId] = useState<string | null>(selected ? symbolRowKey(selected) : null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(chain.slice(0, -1).map(symbolRowKey)),
  )
  const rows = symbolPickerRows(symbols, expanded)
  function toggle(id: string) {
    setExpanded((current) => togglePickerBranch(current, id))
  }
  function activate(id: string) {
    const row = rows.find((row) => row.id === id)
    if (row) onPick(row.symbol)
  }
  const list = useListbox({
    role: 'tree',
    items: rows,
    activeId,
    onActiveChange: setActiveId,
    onCommit: activate,
    onCollapse: toggle,
    onExpand: toggle,
  })
  const focusList = list.focus
  useEffect(() => {
    focusList()
  }, [focusList])
  if (symbols.length === 0) return <EmptyState align='start' title='No symbols' />
  return (
    <div
      {...list.containerProps}
      aria-label='Symbols'
      className='app-scrollbar-thin focus-ring-inset max-h-[inherit] overflow-y-auto py-(--density-gap-tight)'
    >
      <BreadcrumbSymbolRows
        rows={rows}
        rowProps={list.rowProps}
        onPick={activate}
        onToggle={toggle}
      />
    </div>
  )
}
