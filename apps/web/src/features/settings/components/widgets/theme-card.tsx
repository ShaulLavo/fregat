import type { Palette, ThemeBundle } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Badge } from '@workspace/ui/components/badge'
import { ThemeVariantPreview } from '@/features/settings/components/widgets/theme-variant-preview'

export function ThemeCard({
  theme,
  palettes,
  selected,
  customized,
  disabled,
  onPreview,
  onClear,
  onSelect,
}: {
  theme: ThemeBundle
  palettes: readonly Palette[]
  selected: boolean
  customized: boolean
  disabled: boolean
  onPreview: () => void
  onClear: () => void
  onSelect: () => void
}) {
  return (
    <div className='border-border overflow-hidden border' data-theme-bundle={theme.id}>
      <div className='divide-border grid grid-cols-2 divide-x'>
        <ThemeVariantPreview variant={theme.variants.light} mode='light' palettes={palettes} />
        <ThemeVariantPreview variant={theme.variants.dark} mode='dark' palettes={palettes} />
      </div>
      <Button
        className='aria-pressed:bg-accent h-(--bar-height) w-full justify-between px-(--bar-padding-x)'
        variant='ghost'
        disabled={disabled}
        title={`${theme.name} · ${theme.id}`}
        aria-pressed={selected}
        onFocus={(event) => event.currentTarget.matches(':focus-visible') && onPreview()}
        onBlur={onClear}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClear()
            event.currentTarget.blur()
          }
        }}
        onClick={onSelect}
      >
        <span className='truncate text-xs'>{theme.name}</span>
        {selected ? <Badge>{customized ? 'Customized' : 'Current'}</Badge> : null}
      </Button>
    </div>
  )
}
