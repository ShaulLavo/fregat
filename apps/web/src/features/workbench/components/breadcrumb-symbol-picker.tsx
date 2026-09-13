import { EmptyState } from '@workspace/ui/components/empty-state'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { BreadcrumbSymbolRows } from '@/features/workbench/components/breadcrumb-symbol-rows'
import { handlePickerKey } from '@/features/workbench/utils/breadcrumb-picker-keys'
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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectedKey = chain.at(-1) ? symbolRowKey(chain.at(-1)!) : null
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(chain.slice(0, -1).map(symbolRowKey)),
  )

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)

      return next
    })
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container || !selectedKey) return

    const row = container.querySelector<HTMLElement>(
      `[data-breadcrumb-row][data-breadcrumb-path="${CSS.escape(selectedKey)}"]`,
    )
    if (!row) return

    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'center' })
  }, [selectedKey])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (handlePickerKey(event.key, event.currentTarget, toggle)) event.preventDefault()
  }

  if (symbols.length === 0) {
    return <EmptyState align='start' className='px-3 py-2' title='No symbols' />
  }

  return (
    <div
      aria-label='Symbols'
      className='app-scrollbar-thin max-h-[inherit] overflow-y-auto py-(--density-gap-tight)'
      ref={containerRef}
      role='tree'
      onKeyDown={handleKeyDown}
    >
      <BreadcrumbSymbolRows
        depth={0}
        expanded={expanded}
        selectedKey={selectedKey}
        symbols={symbols}
        onPick={onPick}
        onToggle={toggle}
      />
    </div>
  )
}
