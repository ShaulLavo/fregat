import { paletteSupportsMode, type ColorMode, type PaletteId } from '@workspace/contracts'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { VirtualList } from '@workspace/ui/patterns/virtual-list'
import { cn } from '@workspace/ui/lib/utils'

import { useChoiceList } from '@/lib/appearance/hooks/use-choice-list'
import { usePalette } from '@/lib/appearance/hooks/use-palette'
import { paletteSwatches } from '@/lib/appearance/utils/swatches'

/**
 * The palette library as a list with each palette's swatches in `mode`. Arrows choose as they
 * move. `anyMode` lists palettes that lack a `mode` half too.
 */
export function PaletteList({
  anyMode = false,
  className,
  mode,
  value,
  onChange,
}: {
  anyMode?: boolean
  className?: string
  mode: ColorMode
  value: string | null
  onChange: (id: PaletteId) => void
}) {
  const { catalog } = usePalette()
  const options = anyMode ? catalog : catalog.filter((entry) => paletteSupportsMode(entry, mode))
  const { containerRef, virtualRef, list } = useChoiceList({
    items: options.map((entry) => ({ id: entry.id, label: entry.name })),
    activeId: options.some((entry) => entry.id === value) ? value : null,
    onActiveChange: (id) => onChange(id as PaletteId),
  })

  return (
    <VirtualList
      {...list.containerProps}
      activeIndex={list.activeIndex}
      aria-label='Palettes'
      className={cn('focus-ring-inset outline-none', className)}
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
