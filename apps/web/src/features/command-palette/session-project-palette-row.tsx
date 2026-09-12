import { PlusIcon } from '@phosphor-icons/react'
import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import { sessionProjectItemValue } from '@/features/command-palette/command-palette-utils'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'

export function SessionProjectPaletteRow({ project }: { readonly project: SessionRailProject }) {
  const { startSessionDraft } = useCommandPaletteActions()

  return (
    <CommandItem
      keywords={[project.title, project.workspaceRoot, project.qualifier ?? '']}
      value={sessionProjectItemValue(project.key)}
      onSelect={() => startSessionDraft(project.ref)}
    >
      <PlusIcon className='text-muted-foreground' weight='bold' />
      <span className='max-w-[55%] shrink-0 truncate font-medium'>{project.title}</span>
      <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate'>
        {project.workspaceRoot}
      </span>
      <CommandShortcut className='tabular-nums'>{project.sessionCount}</CommandShortcut>
    </CommandItem>
  )
}
