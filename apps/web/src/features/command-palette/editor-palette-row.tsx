import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { fileIconStyle } from '@/lib/file-icon-style'
import { iconForEntry } from '@/lib/file-icons'

import type { EditorPaletteItem } from '@/features/command-palette/command-palette-types'
import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import { RowLabel } from '@/features/command-palette/row-label'
import { tabTitle } from '@/lib/documents/utils/labels'

type EditorPaletteRowProps = {
  readonly item: EditorPaletteItem
}

export function EditorPaletteRow({ item }: EditorPaletteRowProps) {
  const { selectContent } = useCommandPaletteActions()
  const icon = iconForEntry({ name: item.name, type: 'file' })

  return (
    <CommandItem
      keywords={[item.name, item.pathLabel]}
      title={tabTitle(item.content)}
      value={`editor:${item.key}`}
      onSelect={() => selectContent(item.content)}
    >
      <span aria-hidden='true' className='size-4' style={fileIconStyle(icon)} />
      <RowLabel label={item.name} description={item.pathLabel} />
      {item.active && <CommandShortcut>active</CommandShortcut>}
    </CommandItem>
  )
}
