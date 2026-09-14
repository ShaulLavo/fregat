import { ArrowDownIcon, ArrowUpIcon } from '@phosphor-icons/react'

import { ToolbarButton } from '@/components/toolbar-button'
import { useCommand } from '@/keymap/hooks/use-command'

const SOURCE = { kind: 'programmatic', caller: 'workbench.merge-conflict-navigation' } as const

/** VS Code's editor-title arrows for a file with merge conflicts: previous and next conflict. */
export function MergeConflictNavigation() {
  const { bus } = useCommand()

  return (
    <div className='border-border flex items-center gap-(--density-control-gap) self-stretch border-b px-(--bar-padding-x)'>
      <ToolbarButton
        label='Previous conflict'
        onClick={() => bus.dispatch('editor.merge-conflict.previous', { source: SOURCE })}
      >
        <ArrowUpIcon />
      </ToolbarButton>
      <ToolbarButton
        label='Next conflict'
        onClick={() => bus.dispatch('editor.merge-conflict.next', { source: SOURCE })}
      >
        <ArrowDownIcon />
      </ToolbarButton>
    </div>
  )
}
