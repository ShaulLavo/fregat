import { CommandGroup } from '@workspace/ui/components/command'

import { PaletteRow } from '@/features/command-palette/components/row'
import type { CommandPaletteItem } from '@/features/command-palette/utils/types'

type CommandGroupsProps = {
  readonly groups: readonly (readonly [string, readonly CommandPaletteItem[]])[]
}

export function CommandGroups({ groups }: CommandGroupsProps) {
  return (
    <>
      {groups.map(([category, groupItems]) => (
        <CommandGroup key={category} heading={category}>
          {groupItems.map((item) => (
            <PaletteRow disabledReason={item.disabledReason ?? null} item={item} key={item.id} />
          ))}
        </CommandGroup>
      ))}
    </>
  )
}
