import { ListMagnifyingGlassIcon } from '@phosphor-icons/react'

import { HeaderButton } from '@/features/phone/components/header-button'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'

const SOURCE = { kind: 'programmatic', caller: 'phone-header' } as const

/** The phone has no chord to open the palette, so every screen's bar carries it. */
export function PaletteButton() {
  const bus = useCommandBus()

  return (
    <HeaderButton
      command='workspace.showCommandPalette'
      icon={ListMagnifyingGlassIcon}
      label='Command palette'
      onClick={() => bus.dispatch('workspace.showCommandPalette', { source: SOURCE })}
    />
  )
}
