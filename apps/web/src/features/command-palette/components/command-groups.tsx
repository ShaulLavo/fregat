import { CommandGroup } from '@workspace/ui/components/command'

import { PaletteRow } from '@/features/command-palette/components/row'
import type { CommandPaletteItem } from '@/features/command-palette/utils/types'
import { useActions } from '@/features/command-palette/hooks/use-actions'

type CommandGroupsProps = {
  readonly groups: readonly (readonly [string, readonly CommandPaletteItem[]])[]
}

export function CommandGroups({ groups }: CommandGroupsProps) {
  const { disabledReasonForCommand } = useActions()

  return (
    <>
      {groups.map(([category, groupItems]) => (
        <CommandGroup key={category} heading={category}>
          {groupItems.map((item) => (
            <PaletteRow
              disabledReason={disabledReasonForCommand(item.command.command)}
              item={item}
              key={item.id}
            />
          ))}
        </CommandGroup>
      ))}
    </>
  )
}
