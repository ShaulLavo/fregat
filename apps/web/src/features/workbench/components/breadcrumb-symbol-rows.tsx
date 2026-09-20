import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { BreadcrumbPickerRow } from '@/features/workbench/components/breadcrumb-picker-row'
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
    <>
      {rows.map((row) => (
        <BreadcrumbPickerRow
          key={row.id}
          depth={row.depth}
          expandable={row.hasChildren}
          expanded={row.expanded}
          icon={
            <SymbolKindIcon className='size-(--icon-size-sm) shrink-0' kind={row.symbol.kind} />
          }
          label={row.label}
          path={row.id}
          rowProps={rowProps(row.id)}
          trailing={
            <span className='text-muted-foreground text-2xs tabular-nums'>
              {row.symbol.selectionRange.start.line + 1}
            </span>
          }
          onActivate={() => onPick(row.id)}
          onToggle={() => onToggle(row.id)}
        />
      ))}
    </>
  )
}
