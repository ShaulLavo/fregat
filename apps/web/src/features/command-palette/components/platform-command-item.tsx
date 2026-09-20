import type { Icon } from '@phosphor-icons/react'
import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import type { ViewPaletteItem } from '@/features/command-palette/utils/types'
import { useActions } from '@/features/command-palette/hooks/use-actions'
import { RowLabel } from '@/features/command-palette/components/row-label'

export function PlatformCommandItem({
  item,
  icon: Icon,
  active = false,
}: {
  item: ViewPaletteItem
  icon: Icon
  active?: boolean
}) {
  const { disabledReasonForCommand, selectPlatformCommand } = useActions()
  const disabledReason = disabledReasonForCommand(item.command)

  return (
    <CommandItem
      disabled={Boolean(disabledReason)}
      keywords={[item.title, item.description, item.command]}
      value={item.value}
      onSelect={() => void selectPlatformCommand(item.command)}
    >
      <Icon className='text-muted-foreground' />
      <RowLabel label={item.title} description={disabledReason ?? item.description} />
      {active && <CommandShortcut>active</CommandShortcut>}
    </CommandItem>
  )
}
