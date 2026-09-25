import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'

import { diagnosticRuleClass } from '@/features/workbench/utils/diagnostic-style'
import type { DiagnosticItemRow } from '@/features/workbench/utils/diagnostic-rows'
import { diagnosticSeverityLabel } from '@/lib/diagnostic'

/** One diagnostic: severity and line on the row, then its complete message beneath. */
export function DiagnosticRow({
  row,
  rowProps,
  onOpen,
}: {
  readonly row: DiagnosticItemRow
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly onOpen: () => void
}) {
  const line = row.target.range.start.line + 1
  return (
    <div className={cn('border-l-2', diagnosticRuleClass(row.diagnostic.severity))}>
      <ListRow
        {...rowProps}
        as='button'
        role='treeitem'
        aria-level={2}
        className='w-full text-left'
        title={`${row.path}:${line}\n${row.label}`}
        type='button'
        onClick={(event) => {
          rowProps.onClick(event)
          onOpen()
        }}
      >
        <span className='text-muted-foreground'>
          {diagnosticSeverityLabel(row.diagnostic.severity)}
        </span>
        <span className='text-muted-foreground text-2xs ml-auto tabular-nums'>Line {line}</span>
      </ListRow>
      <p className='px-(--density-row-padding-x) pb-(--density-gap-tight)'>{row.label}</p>
    </div>
  )
}
