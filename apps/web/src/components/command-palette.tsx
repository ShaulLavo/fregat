import { CommandPaletteContent } from '@/features/command-palette/components/content'
import { useCommand } from '@/keymap/hooks/use-command'

export function CommandPalette() {
  const { paletteOpen } = useCommand()
  if (!paletteOpen) return null

  return <CommandPaletteContent />
}
