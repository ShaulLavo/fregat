import { ListRow } from '@workspace/ui/patterns/list-row'
import type { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'

import { diagnosticRuleClass } from '@/features/workbench/utils/diagnostic-style'
import type { DiagnosticItemRow } from '@/features/workbench/utils/diagnostic-rows'
import { diagnosticSeverityLabel } from '@/lib/diagnostic'
import { FixDiagnosticButton } from '@/features/workbench/components/fix-diagnostic-button'

/** One diagnostic: severity and line on the row, then its complete message beneath. */
export function DiagnosticRow({
  fixing,
  row,
  rowProps,
  onFix,
  onOpen,
}: {
  /** Absent where there is no chat to open. */
  readonly fixing: boolean | null
  readonly row: DiagnosticItemRow
  readonly rowProps: ReturnType<ReturnType<typeof useListbox>['rowProps']>
  readonly onFix: () => void
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
      <div className='flex items-start gap-(--density-gap-tight) px-(--density-row-padding-x) pb-(--density-gap-tight)'>
        <p className='min-w-0 flex-1'>{row.label}</p>
        {fixing === null ? null : <FixDiagnosticButton pending={fixing} onFix={onFix} />}
      </div>
    </div>
  )
}
