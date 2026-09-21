import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { BreadcrumbPickerRowList } from '@/features/workbench/components/breadcrumb-picker-row-list'
import { SymbolKindIcon } from '@/features/workbench/components/symbol-kind-icon'
import type { SymbolPickerRow } from '@/features/workbench/utils/breadcrumb-picker-rows'

export function BreadcrumbSymbolRows({
  rows,
  rowProps,
  onPick,
  onToggle,
}: {
  rows: readonly SymbolPickerRow[]
  rowProps: ReturnType<typeof useListbox>['rowProps']
  onPick: (id: string) => void
  onToggle: (id: string) => void
}) {
  return (
    <BreadcrumbPickerRowList
      rows={rows}
      rowProps={rowProps}
      renderIcon={(row) => (
        <SymbolKindIcon className='size-(--icon-size-sm) shrink-0' kind={row.symbol.kind} />
      )}
      renderTrailing={(row) => (
        <span className='text-muted-foreground text-2xs tabular-nums'>
          {row.symbol.selectionRange.start.line + 1}
        </span>
      )}
      onActivate={onPick}
      onToggle={onToggle}
    />
  )
}
