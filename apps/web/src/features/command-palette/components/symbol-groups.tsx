import type { FlatDocumentSymbol } from '@/lib/document-symbols'
import { TextTIcon } from '@phosphor-icons/react'
import { CommandGroup, CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { SymbolsLoading } from '@/features/command-palette/components/symbols-loading'
import { useActions } from '@/features/command-palette/hooks/use-actions'
import {
  symbolDescription,
  symbolKindLabel,
  symbolRowTitle,
} from '@/features/command-palette/utils/query'
import { RowLabel } from '@/features/command-palette/components/row-label'

type SymbolGroupsProps = {
  readonly isPending: boolean
  readonly items: readonly FlatDocumentSymbol[]
}

export function SymbolGroups({ isPending, items }: SymbolGroupsProps) {
  const { selectSymbol } = useActions()

  if (isPending) {
    // Still a CommandItem: an empty group would let cmdk's CommandEmpty render
    // "No symbols" over a list that is merely still fetching.
    return (
      <CommandGroup heading='Symbols'>
        <CommandItem disabled value='symbols:loading'>
          <SymbolsLoading />
        </CommandItem>
      </CommandGroup>
    )
  }

  return (
    <CommandGroup heading='Symbols'>
      {items.map((item, index) => (
        <CommandItem
          key={`${item.name}:${item.selectionRange.start.line}:${index}`}
          keywords={[item.name, item.containerName ?? '', symbolKindLabel(item.kind)]}
          title={symbolRowTitle(item)}
          value={`symbol:${item.name}:${index}`}
          onSelect={() => selectSymbol(item)}
        >
          <TextTIcon className='text-muted-foreground' />
          <RowLabel label={item.name} description={symbolDescription(item)} />
          <CommandShortcut className='tabular-nums'>
            {item.selectionRange.start.line + 1}
          </CommandShortcut>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}
