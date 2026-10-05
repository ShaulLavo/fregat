import { Button } from '@workspace/ui/components/button'
import { useSettingValue } from '@/hooks/use-setting-value'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { EditorGroup } from '@/features/workbench/components/editor-group'
import { allEditorGroups } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { useWorkspaceTreeForRootPath } from '@/features/workspace/hooks/use-tree'

export function RetentionIdentityEntry({ filesystem = false }: { readonly filesystem?: boolean }) {
  useWorkspaceTreeForRootPath(filesystem ? 'repo' : null)
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  const enabled = useSettingValue('editor.syntaxHighlighting.enabled')
  const settings = useSettingsActions()
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <Button
        aria-label='Fixture syntax highlighting'
        aria-pressed={enabled}
        onClick={() => settings.setSetting('editor.syntaxHighlighting.enabled', !enabled)}
      >
        Syntax highlighting
      </Button>
      <div className='flex min-h-0 flex-1'>
        {allEditorGroups(groups).map((group) => (
          <EditorGroup
            key={group.id}
            active={group.id === groups.activeGroupId}
            conflicts={{}}
            gitFiles={[]}
            group={group}
            rootPath={filesystemPath('repo')}
          />
        ))}
      </div>
    </div>
  )
}
