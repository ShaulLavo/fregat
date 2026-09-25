import { PaletteCard } from '@/features/dev/components/palette-card'
import { bundledPalettePreviews } from '@/features/dev/utils/palette-previews'

const PREVIEWS = bundledPalettePreviews()

export function PaletteGrid() {
  return (
    <div className='grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-(--density-control-gap)'>
      {PREVIEWS.map((preview) => (
        <PaletteCard key={preview.key} preview={preview} />
      ))}
    </div>
  )
}
