import { BreadcrumbPickerRow } from '@/features/workbench/components/breadcrumb-picker-row'
import { SymbolKindIcon } from '@/features/workbench/components/symbol-kind-icon'
import { sortPickerSymbols, symbolRowKey } from '@/features/workbench/utils/breadcrumbs'
import type { DocumentSymbol } from '@/lib/document-symbols'

export function BreadcrumbSymbolRows({
  depth,
  expanded,
  selectedKey,
  symbols,
  onPick,
  onToggle,
}: {
  readonly depth: number
  readonly expanded: ReadonlySet<string>
  readonly selectedKey: string | null
  readonly symbols: readonly DocumentSymbol[]
  readonly onPick: (symbol: DocumentSymbol) => void
  readonly onToggle: (key: string) => void
}) {
  return (
    <>
      {sortPickerSymbols(symbols).map((symbol) => {
        const key = symbolRowKey(symbol)
        const children = symbol.children ?? []
        const isExpanded = children.length > 0 && expanded.has(key)
        return (
          <div key={key}>
            <BreadcrumbPickerRow
              depth={depth}
              expandable={children.length > 0}
              expanded={isExpanded}
              icon={<SymbolKindIcon className='size-3.5 shrink-0' kind={symbol.kind} />}
              label={symbol.name}
              path={key}
              selected={key === selectedKey}
              trailing={
                <span className='text-muted-foreground text-3xs tabular-nums'>
                  {symbol.selectionRange.start.line + 1}
                </span>
              }
              onActivate={() => onPick(symbol)}
              onToggle={() => onToggle(key)}
            />
            {isExpanded ? (
              <BreadcrumbSymbolRows
                depth={depth + 1}
                expanded={expanded}
                selectedKey={selectedKey}
                symbols={children}
                onPick={onPick}
                onToggle={onToggle}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}
