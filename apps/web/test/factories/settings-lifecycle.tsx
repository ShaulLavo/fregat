import { Button } from '@workspace/ui/components/button'
import { useDirtyTabCloseRequest } from '@/features/editor/hooks/use-dirty-tab-close'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'

export function SettingsLifecycle() {
  const close = useDirtyTabCloseRequest()
  const commands = useEditorCommands()
  const tabs = useEditorWorkspaceState((state) => state.workbenchPanels.editorTabs)

  return (
    <div data-workbench=''>
      <Button onClick={() => void commands.openSettingsEditor()}>Open settings</Button>
      <Button onClick={() => close.requestCloseTabs(tabs.map((tab) => tab.id))}>
        Close all settings
      </Button>
      {tabs.map((tab) => (
        <Button key={tab.id} onClick={() => close.requestCloseTab(tab.id)}>
          Close {tab.id}
        </Button>
      ))}
      <output aria-label='Settings tab count'>{tabs.length}</output>
      {close.dirtyTabCloseDialog}
    </div>
  )
}
