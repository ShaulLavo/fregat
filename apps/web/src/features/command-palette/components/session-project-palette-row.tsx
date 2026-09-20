import { PlusIcon } from '@phosphor-icons/react'
import { CommandItem, CommandShortcut } from '@workspace/ui/components/command'

import { useActions } from '@/features/command-palette/hooks/use-actions'
import { RowLabel } from '@/features/command-palette/components/row-label'
import {
  sessionProjectItemValue,
  sessionProjectRowTitle,
} from '@/features/command-palette/utils/query'
import type { SessionRailProject } from '@workspace/client-core/chat/rail/model'

export function SessionProjectPaletteRow({ project }: { readonly project: SessionRailProject }) {
  const { startSessionDraft } = useActions()

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
