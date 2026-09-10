import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'
import { cn } from '@workspace/ui/lib/utils'

import { CommandPaletteIcon } from '@/features/command-palette/command-palette-icon'
import { RowLabel } from '@/features/command-palette/row-label'
import type { CommandPaletteItem } from '@/features/command-palette/command-palette-types'
import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'

type CommandPaletteRowProps = {
  readonly disabledReason: string | null
  readonly item: CommandPaletteItem
}

export function CommandPaletteRow({ disabledReason, item }: CommandPaletteRowProps) {
  const { selectPlatformCommand } = useCommandPaletteActions()
  const disabled = Boolean(disabledReason)

  return (
    <CommandItem
      disabled={disabled}
      keywords={item.keywords}
      value={item.id}
      onSelect={() => void selectPlatformCommand(item.command.command)}
    >
      <CommandPaletteIcon category={item.category} command={item.command.command} />
      <RowLabel
        label={item.title}
        description={disabledReason ?? item.description}
        descriptionClassName={cn(disabled && 'text-muted-foreground/70')}
      />
      {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
    </CommandItem>
  )
}
