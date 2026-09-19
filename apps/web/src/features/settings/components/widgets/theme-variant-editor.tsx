import { paletteSupportsMode, type ColorMode, type ThemeVariant } from '@workspace/contracts'
import { Input } from '@workspace/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@workspace/ui/components/select'
import { usePaletteCatalog } from '@/features/settings/hooks/use-palette-catalog'
import { CodeThemeWidget } from '@/features/settings/components/widgets/code-theme-widget'
import { materialLimits, materialLabels } from '@/features/settings/utils/bundle-editing'
import { WallpaperWidget } from '@/features/settings/components/widgets/wallpaper-widget'

export function ThemeVariantEditor({
  mode,
  value,
  onChange,
  disabled,
}: {
  mode: ColorMode
  value: ThemeVariant
  onChange: (variant: ThemeVariant) => void
  disabled: boolean
}) {
  const palettes = usePaletteCatalog().filter((palette) => paletteSupportsMode(palette, mode))
  return (
    <div className='flex min-w-0 flex-col gap-4' aria-label={`${mode} variant`}>
      <label className='text-xs font-medium' htmlFor={`theme-palette-${mode}`}>
        App and terminal colors
      </label>
      <Select
        value={value.palette}
        disabled={disabled}
        onValueChange={(palette) => palette && onChange({ ...value, palette })}
      >
        <SelectTrigger id={`theme-palette-${mode}`} className='w-full'>
          <SelectValue>
            {palettes.find((palette) => palette.id === value.palette)?.name ?? value.palette}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {palettes.map((palette) => (
            <SelectItem key={palette.id} value={palette.id}>
              {palette.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <CodeThemeWidget
        id={`editor.codeTheme.${mode}`}
        value={value.codeTheme}
        disabled={disabled}
        onChange={(codeTheme) => onChange({ ...value, codeTheme })}
      />
      <WallpaperWidget
        value={value.wallpaper}
        disabled={disabled}
        onChange={(wallpaper) => onChange({ ...value, wallpaper })}
      />
      <div className='grid grid-cols-2 gap-3'>
        {(['opacity', 'contentOpacity', 'blur', 'saturation'] as const).map((key) => (
          <div className='flex flex-col gap-1' key={key}>
            <label className='text-xs font-medium' htmlFor={`theme-${mode}-${key}`}>
              {materialLabels[key]}
            </label>
            <Input
              className='tabular-nums'
              id={`theme-${mode}-${key}`}
              type='number'
              min={0}
              max={materialLimits[key]}
              disabled={disabled}
              value={value.material[key]}
              onChange={(event) =>
                onChange({
                  ...value,
                  material: { ...value.material, [key]: Number(event.target.value) },
                })
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}
