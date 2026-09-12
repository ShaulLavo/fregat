import { CommandItem } from '@workspace/ui/components/command'

import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'

import type { FilePaletteItem } from '@/features/command-palette/command-palette-types'
import { fileItemValue } from '@/features/command-palette/command-palette-utils'
import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'

type FilePaletteRowProps = {
  readonly item: FilePaletteItem
}

export function FilePaletteRow({ item }: FilePaletteRowProps) {
  const { selectFile } = useCommandPaletteActions()
  const icon = iconForEntry({ name: item.entry.name, type: item.entry.type })

  return (
    <CommandItem
      keywords={[item.entry.name, item.entry.path, item.pathLabel]}
      value={fileItemValue(item)}
      onSelect={() => selectFile(item.entry.path)}
    >
      <span aria-hidden='true' className='size-4' style={fileIconStyle(icon)} />
      <span className='max-w-[55%] shrink-0 truncate font-medium'>{item.entry.name}</span>
      <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate'>
        {item.pathLabel}
      </span>
    </CommandItem>
  )
}
