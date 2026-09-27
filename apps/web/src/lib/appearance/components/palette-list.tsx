import { paletteSupportsMode, type ColorMode, type PaletteId } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import { cn } from '@workspace/ui/lib/utils'

import { useChoiceList } from '@/lib/appearance/hooks/use-choice-list'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { paletteSwatches } from '@/lib/appearance/utils/swatches'

/**
 * The palette library as a list with each palette's swatches in `mode`. `anyMode` lists palettes
 * that lack a `mode` half too; `live` chooses as the cursor moves. `maxRows` sizes the list to
 * its rows, up to that many.
 */
export function PaletteList({
  anyMode = false,
  className,
  labelledBy,
  live = false,
  maxRows,
  mode,
  value,
  onChange,
}: {
  anyMode?: boolean
  className?: string
  labelledBy?: string
  live?: boolean
  maxRows?: number
  mode: ColorMode
  value: string | null
  onChange: (id: PaletteId) => void
}) {
  const { catalog } = usePalette()
  const options = anyMode ? catalog : catalog.filter((entry) => paletteSupportsMode(entry, mode))
  const { containerRef, virtualRef, list } = useChoiceList({
    items: options.map((entry) => ({ id: entry.id, label: entry.name })),
    live,
    value: options.some((entry) => entry.id === value) ? value : null,
    onChoose: (id) => onChange(id as PaletteId),
  })
  const rows = maxRows === undefined ? undefined : Math.min(options.length, maxRows)

  return (
    <VirtualList
      {...list.containerProps}
      activeIndex={list.activeIndex}
      aria-label={labelledBy ? undefined : 'Palettes'}
      aria-labelledby={labelledBy}
      className={cn('focus-ring-inset outline-none', className)}
      style={
        rows === undefined ? undefined : { height: `calc(var(--density-row-height) * ${rows})` }
      }
      getKey={(entry) => entry.id}
      handleRef={virtualRef}
      items={options}
      renderRow={(entry) => (
        <ListRow
          {...list.rowProps(entry.id)}
          role='option'
          selected={entry.id === value}
          title={entry.name}
        >
          <span className='min-w-0 flex-1 truncate'>{entry.name}</span>
          <span aria-hidden='true' className='flex shrink-0 gap-0.5'>
            {paletteSwatches(entry, mode).map((color, index) => (
              <span
                className='size-2.5 rounded-md'
                key={index}
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
        </ListRow>
      )}
      scrollRef={containerRef}
    />
  )
}
