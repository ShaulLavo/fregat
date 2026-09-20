import { FileIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem } from '@workspace/ui/components/command'

import type { FilePaletteItem } from '@/features/command-palette/utils/types'
import { FilePaletteRow } from '@/features/command-palette/components/file-palette-row'

type QuickOpenGroupsProps = {
  readonly files: readonly FilePaletteItem[]
  readonly hasWorkspace: boolean
  readonly query: string
  readonly searchError: boolean
}

export function QuickOpenGroups({ files, hasWorkspace, query, searchError }: QuickOpenGroupsProps) {
  if (!hasWorkspace) {
    return null
  }

  return (
    <CommandGroup heading='Files'>
      {searchError && (
        <CommandItem disabled keywords={[query]} value={`files:error:${query}`}>
          <FileIcon className='text-muted-foreground' />
          <span className='text-muted-foreground text-sm'>File search failed</span>
        </CommandItem>
      )}
      {files.map((item) => (
        <FilePaletteRow item={item} key={item.entry.path} />
      ))}
    </CommandGroup>
  )
}
