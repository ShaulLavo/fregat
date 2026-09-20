import { FileTypeIcon } from '@/components/file-type-icon'
import { CommandItem } from '@workspace/ui/components/command'

import { iconForEntry } from '@/lib/file-icons'

import type { FilePaletteItem } from '@/features/command-palette/utils/types'
import { fileItemValue } from '@/features/command-palette/utils/query'
import { useActions } from '@/features/command-palette/hooks/use-actions'
import { RowLabel } from '@/features/command-palette/components/row-label'

type FilePaletteRowProps = {
  readonly item: FilePaletteItem
}

export function FilePaletteRow({ item }: FilePaletteRowProps) {
  const { selectFile } = useActions()
  const icon = iconForEntry({ name: item.entry.name, type: item.entry.type })

  return (
    <CommandItem
      keywords={[item.entry.name, item.entry.path, item.pathLabel]}
      title={item.entry.path}
      value={fileItemValue(item)}
      onSelect={() => selectFile(item.entry.path)}
    >
      <FileTypeIcon className='size-(--icon-size)' icon={icon} />
      <RowLabel label={item.entry.name} description={item.pathLabel} />
    </CommandItem>
  )
}
