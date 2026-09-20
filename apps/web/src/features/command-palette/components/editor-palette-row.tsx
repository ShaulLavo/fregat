import { FileTypeIcon } from '@/components/file-type-icon'
import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { iconForEntry } from '@/lib/file-icons'

import type { EditorPaletteItem } from '@/features/command-palette/utils/types'
import { useActions } from '@/features/command-palette/hooks/use-actions'
import { RowLabel } from '@/features/command-palette/components/row-label'
import { tabTitle } from '@/lib/documents/utils/labels'

type EditorPaletteRowProps = {
  readonly item: EditorPaletteItem
}

export function EditorPaletteRow({ item }: EditorPaletteRowProps) {
  const { selectContent } = useActions()
  const icon = iconForEntry({ name: item.name, type: 'file' })

  return (
    <CommandItem
      keywords={[item.name, item.pathLabel]}
      title={tabTitle(item.content)}
      value={`editor:${item.key}`}
      onSelect={() => selectContent(item.content)}
    >
      <FileTypeIcon className='size-(--icon-size)' icon={icon} />
      <RowLabel label={item.name} description={item.pathLabel} />
      {item.active && <CommandShortcut>active</CommandShortcut>}
    </CommandItem>
  )
}
