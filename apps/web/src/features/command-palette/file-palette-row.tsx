import { FileTypeIcon } from '@/components/file-type-icon'
import { CommandItem } from '@workspace/ui/components/command'

import { iconForEntry } from '@/lib/file-icons'

import type { FilePaletteItem } from '@/features/command-palette/command-palette-types'
import { fileItemValue } from '@/features/command-palette/command-palette-utils'
import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import { RowLabel } from '@/features/command-palette/row-label'

type FilePaletteRowProps = {
  readonly item: FilePaletteItem
}

export function FilePaletteRow({ item }: FilePaletteRowProps) {
  const { selectFile } = useCommandPaletteActions()
  const icon = iconForEntry({ name: item.entry.name, type: item.entry.type })

  return (
    <CommandItem
      keywords={[item.entry.name, item.entry.path, item.pathLabel]}
      title={item.entry.path}
      value={fileItemValue(item)}
      onSelect={() => selectFile(item.entry.path)}
    >
      <FileTypeIcon className='size-4' icon={icon} />
      <RowLabel label={item.entry.name} description={item.pathLabel} />
    </CommandItem>
  )
}
