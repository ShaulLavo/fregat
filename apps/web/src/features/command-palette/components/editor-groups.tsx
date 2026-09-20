import { CommandGroup } from '@workspace/ui/components/command'

import type { EditorPaletteItem } from '@/features/command-palette/utils/types'
import { EditorPaletteRow } from '@/features/command-palette/components/editor-palette-row'

type EditorGroupsProps = {
  readonly items: readonly EditorPaletteItem[]
}

export function EditorGroups({ items }: EditorGroupsProps) {
  return (
    <CommandGroup heading='Open Editors'>
      {items.map((item) => (
        <EditorPaletteRow item={item} key={item.key} />
      ))}
    </CommandGroup>
  )
}
