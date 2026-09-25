import {
  paletteColorsFor,
  toCss,
  type ColorMode,
  type Palette,
  type ThemeVariant,
} from '@workspace/contracts'
import { PaletteSwatches } from '@/features/settings/components/widgets/palette-swatches'
import { CodeThemePreview } from '@/lib/code-theme/components/preview'
import { libraryImageUrl } from '@/lib/wallpapers/state/queries'

export function ThemeVariantPreview({
  variant,
  mode,
  palettes,
}: {
  variant: ThemeVariant
  mode: ColorMode
  palettes: readonly Palette[]
}) {
  const palette = palettes.find((entry) => entry.id === variant.palette)
  const colors = palette ? paletteColorsFor(palette, mode) : null
  const source = variant.wallpaper.source
  return (
    <div className='min-w-0 overflow-hidden' aria-label={`${mode} theme preview`}>
      <div
        className='bg-muted relative flex h-16 items-end overflow-hidden p-2'
        style={colors ? { backgroundColor: toCss(colors.app.background) } : undefined}
      >
        {variant.wallpaper.enabled && source.kind === 'library' ? (
          <img
            crossOrigin='anonymous'
            src={libraryImageUrl(source.asset, 'thumbnail')}
            alt=''
            className='absolute inset-0 size-full object-cover'
          />
        ) : null}
        {/* The palette name is what tells a Graphite stand-in from a real dark version. */}
        <span
          className='bg-popover-solid text-foreground text-2xs relative max-w-full truncate rounded-md px-1.5 py-0.5'
          title={palette ? `${palette.name} ${mode}` : undefined}
        >
          {mode === 'light' ? 'Light' : 'Dark'}
          {palette ? ` · ${palette.name}` : null}
        </span>
      </div>
      {palette ? (
        <PaletteSwatches
          colors={paletteColorsFor(palette, mode)}
          label={`${palette.name} ${mode}`}
        />
      ) : null}
      <div className='h-20 overflow-hidden'>
        <CodeThemePreview themeId={variant.codeTheme} />
      </div>
      <div
        className='bg-card-solid text-muted-foreground text-3xs font-meta px-2 py-1'
        style={
          colors
            ? {
                color: toCss(colors.terminal.foreground),
                backgroundColor: toCss(colors.app.background),
              }
            : undefined
        }
      >
        $ ready
      </div>
    </div>
  )
}
