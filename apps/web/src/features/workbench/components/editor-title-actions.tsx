import { ToolbarButton } from '@/components/toolbar-button'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { useSettingValue } from '@/hooks/use-setting-value'
import { editorTitleActions } from '@/keymap/editor-title-actions'
import { useCommand } from '@/keymap/hooks/use-command'

const SOURCE = { kind: 'programmatic', caller: 'workbench.editor-title-actions' } as const

/** The active tab's controls, at the end of its tab strip. Which ones is the registry's call. */
export function EditorTitleActions({ tab }: { readonly tab: EditorTabModel }) {
  const { bus } = useCommand()
  const diffViewMode = useSettingValue('editor.diff.viewMode')
  const actions = editorTitleActions({ diffViewMode, tab })

  if (actions.length === 0) return null

  return (
    <div className='flex items-center gap-(--density-control-gap) self-stretch px-(--bar-padding-x)'>
      {actions.map(({ command, icon: ActionIcon, label }) => (
        <ToolbarButton
          key={command}
          label={label}
          onClick={() => bus.dispatch(command, { source: SOURCE })}
        >
          <ActionIcon />
        </ToolbarButton>
      ))}
    </div>
  )
}
