import { commandIcons } from '@/keymap/table'
import type { PlatformCommandId } from '@/keymap/types'

import { CommandCategoryIcon } from '@/features/command-palette/components/command-category-icon'

type PaletteIconProps = {
  readonly category: string
  readonly command: PlatformCommandId
}

// A meaningful icon per command makes the palette scannable instead of a wall
// of identical category glyphs. Anything without an `icon` on its table entry
// falls back to its category icon, so partial coverage degrades gracefully.
export function PaletteIcon({ category, command }: PaletteIconProps) {
  const ResolvedIcon = commandIcons[command]
  if (!ResolvedIcon) return <CommandCategoryIcon category={category} />

  return <ResolvedIcon className='text-muted-foreground' weight='duotone' />
}
