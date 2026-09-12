import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'

import type { EditorPaletteItem } from '@/features/command-palette/command-palette-types'
import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'

type EditorPaletteRowProps = {
  readonly item: EditorPaletteItem
}

export function EditorPaletteRow({ item }: EditorPaletteRowProps) {
  const { selectContent } = useCommandPaletteActions()
  const icon = iconForEntry({ name: item.name, type: 'file' })

  return (
    <CommandItem
      keywords={[item.name, item.pathLabel]}
      value={`editor:${item.key}`}
      onSelect={() => selectContent(item.content)}
    >
      <span aria-hidden='true' className='size-4' style={fileIconStyle(icon)} />
      <span className='max-w-[55%] shrink-0 truncate font-medium'>{item.name}</span>
      <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate'>
        {item.pathLabel}
      </span>
      {item.active && <CommandShortcut>active</CommandShortcut>}
    </CommandItem>
  )
}
