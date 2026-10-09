import { GearSixIcon } from '@phosphor-icons/react'

import { HeaderButton } from '@/features/phone/components/header-button'
import { useCommandBus } from '@/keymap/hooks/use-command-bus'

export function SettingsButton({ caller }: { readonly caller: string }) {
  const bus = useCommandBus()

  return (
    <HeaderButton
      command='workspace.showSettings'
      icon={GearSixIcon}
      label='Settings'
      onClick={() =>
        bus.dispatch('workspace.showSettings', {
          source: { kind: 'programmatic', caller },
        })
      }
    />
  )
}
