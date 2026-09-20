import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'
import { cn } from '@workspace/ui/lib/utils'

import { PaletteIcon } from '@/features/command-palette/components/icon'
import { RowLabel } from '@/features/command-palette/components/row-label'
import type { CommandPaletteItem } from '@/features/command-palette/utils/types'
import { useActions } from '@/features/command-palette/hooks/use-actions'

type PaletteRowProps = {
  readonly disabledReason: string | null
  readonly item: CommandPaletteItem
}

export function PaletteRow({ disabledReason, item }: PaletteRowProps) {
  const { selectPlatformCommand } = useActions()
  const disabled = Boolean(disabledReason)

  return (
    <CommandItem
      disabled={disabled}
      keywords={item.keywords}
      value={item.id}
      onSelect={() => void selectPlatformCommand(item.command.command)}
    >
      <PaletteIcon category={item.category} command={item.command.command} />
      <RowLabel
        label={item.title}
        description={disabledReason ?? item.description}
        descriptionClassName={cn(disabled && 'text-muted-foreground')}
      />
      {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
    </CommandItem>
  )
}
