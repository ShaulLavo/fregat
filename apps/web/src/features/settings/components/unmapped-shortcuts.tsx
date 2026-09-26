import { CaretRightIcon } from '@phosphor-icons/react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import type { PlatformName } from '@workspace/client-core/commands/chord'

import { ShortcutKeys } from '@/features/settings/components/shortcut-keys'
import type { UnmappedKeyBinding } from '@/keymap/default-bindings'

/** VS Code bindings the VS Code mode cannot carry, with why, collapsed under the list. */
export function UnmappedShortcuts({
  platform,
  unmapped,
}: {
  platform: PlatformName
  unmapped: readonly UnmappedKeyBinding[]
}) {
  if (unmapped.length === 0) return null

  return (
    <Collapsible className='flex flex-col gap-1 pt-2'>
      <CollapsibleTrigger className='group/unmapped text-muted-foreground focus-ring flex items-center gap-1 self-start rounded-md text-xs'>
        <CaretRightIcon
          aria-hidden
          className='size-(--icon-size-sm) group-data-[panel-open]/unmapped:rotate-90'
        />
        VS Code shortcuts not available here
        <span className='text-2xs font-mono tabular-nums'>{unmapped.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className='flex flex-col'>
        {unmapped.map((entry) => (
          <div
            className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-(--density-row-padding-x) py-1 text-xs'
            key={`${entry.command}:${entry.keys}`}
          >
            <span className='truncate font-mono' title={entry.command}>
              {entry.command}
            </span>
            <ShortcutKeys keys={entry.keys} platform={platform} />
            <span className='text-muted-foreground text-2xs col-span-2'>{entry.reason}</span>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
