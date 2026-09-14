import { PlusIcon } from '@phosphor-icons/react'
import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { useCommandPaletteActions } from '@/features/command-palette/hooks/use-command-palette-actions'
import { RowLabel } from '@/features/command-palette/row-label'
import {
  sessionProjectItemValue,
  sessionProjectRowTitle,
} from '@/features/command-palette/command-palette-utils'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'

export function SessionProjectPaletteRow({ project }: { readonly project: SessionRailProject }) {
  const { startSessionDraft } = useCommandPaletteActions()

  return (
    <CommandItem
      keywords={[project.title, project.workspaceRoot, project.qualifier ?? '']}
      title={sessionProjectRowTitle(project)}
      value={sessionProjectItemValue(project.key)}
      onSelect={() => startSessionDraft(project.ref)}
    >
      <PlusIcon className='text-muted-foreground' weight='bold' />
      <RowLabel label={project.title} description={project.workspaceRoot} />
      <CommandShortcut className='tabular-nums'>{project.sessionCount}</CommandShortcut>
    </CommandItem>
  )
}
