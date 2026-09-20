import { useState } from 'react'
import type {
  LanguageServerDefinitionTarget,
  LanguageServerDiagnosticSummary,
} from '@singapore-editor/lsp-plugin'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { cn } from '@workspace/ui/lib/utils'

import { diagnosticRuleClass } from '@/features/workbench/utils/diagnostic-style'
import {
  diagnosticMessageText,
  diagnosticSeverityLabel,
  diagnosticTarget,
  fileUriForPath,
} from '@/lib/diagnostic'

export function DiagnosticList({
  diagnostics,
  path,
  onOpenDiagnostic,
  onPreviewDiagnostic,
}: {
  diagnostics: LanguageServerDiagnosticSummary
  path: string
  onOpenDiagnostic(target: LanguageServerDefinitionTarget): void | boolean
  onPreviewDiagnostic(target: LanguageServerDefinitionTarget): void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const rows = diagnostics.diagnostics.map((diagnostic, index) => ({
    id: `${index}`,
    label: diagnosticMessageText(diagnostic.message),
    diagnostic,
    target: diagnosticTarget(path, diagnostics.uri ?? fileUriForPath(path), diagnostic),
  }))
  function activate(id: string) {
    const row = rows.find((row) => row.id === id)
    if (row) onOpenDiagnostic(row.target)
  }
  function select(id: string) {
    setActiveId(id)
    const row = rows.find((row) => row.id === id)
    if (row) onPreviewDiagnostic(row.target)
  }
  const list = useListbox({
    role: 'listbox',
    items: rows,
    activeId,
    onActiveChange: select,
    onCommit: activate,
  })
  return (
    <div
      {...list.containerProps}
      aria-label='Diagnostics'
      className='focus-ring-inset mt-3 space-y-2'
    >
      {rows.map((row) => {
        const rowProps = list.rowProps(row.id)
        return (
          <div
            className={cn('border border-l-2', diagnosticRuleClass(row.diagnostic.severity))}
            key={row.id}
          >
            <ListRow
              {...rowProps}
              as='button'
              role='option'
              className='w-full text-left'
              title={`${path}:${row.target.range.start.line + 1}\n${row.label}`}
              onClick={(event) => {
                rowProps.onClick(event)
                onOpenDiagnostic(row.target)
              }}
              onMouseEnter={() => onPreviewDiagnostic(row.target)}
            >
              <span className='text-muted-foreground'>
                {diagnosticSeverityLabel(row.diagnostic.severity)}
              </span>
              <span className='text-muted-foreground text-2xs ml-auto tabular-nums'>
                Line {row.target.range.start.line + 1}
              </span>
            </ListRow>
            <p className='px-(--density-row-padding-x) pb-(--density-gap-tight)'>{row.label}</p>
          </div>
        )
      })}
    </div>
  )
}
