import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { useEditorUiState } from '@/features/editor/state/ui-state'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useEditorGroupActions } from '@/features/editor/hooks/use-editor-group-actions'
import { allEditorGroups, groupForTab } from '@/lib/documents/utils/groups'
import { tabLabel } from '@/lib/documents/utils/labels'
import type { GroupId } from '@/lib/documents/utils/group-types'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

export function MoveTabToGroupDialog() {
  const tabId = useEditorUiState((state) => state.moveTabId)
  const setMoveTabId = useEditorUiState((state) => state.setMoveTabId)
  const groups = useEditorWorkspaceState((state) => state.workbenchPanels.editorGroups)
  const commands = useEditorGroupActions()
  const source = tabId ? groupForTab(groups, tabId) : null
  const tab = source?.tabs.find((item) => item.id === tabId)
  const { ref } = useFocusTarget<HTMLDivElement>(
    {
      area: 'dialog',
      capabilities: { overlay: true },
      id: { kind: 'editor-group-dialog' },
      onIntent: (intent, element) => {
        if (intent !== 'focus' || !tab) return false
        element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
        return true
      },
    },
    tab !== undefined,
  )

  function close() {
    setMoveTabId(null)
    if (source && tabId) void commands.selectTab({ groupId: source.id, tabId })
  }

  function move(groupId: GroupId) {
    if (!tabId) return
    setMoveTabId(null)
    void commands.placeTab({ tabId, mode: 'move', target: { kind: 'group', groupId } })
  }

  return (
    <Dialog
      open={tab !== undefined}
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent ref={ref} finalFocus={false} className='gap-0 p-0'>
        <DialogHeader className='border-border h-(--bar-height) justify-center border-b px-(--bar-padding-x)'>
          <DialogTitle>Move tab to group</DialogTitle>
          <DialogDescription className='sr-only'>
            Choose a destination for {tab ? tabLabel(tab.content) : 'the tab'}.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-1 p-2'>
          {allEditorGroups(groups).map((group, index) => (
            <Button
              key={group.id}
              variant='ghost'
              className='justify-start tabular-nums'
              disabled={group.id === source?.id}
              onClick={() => move(group.id)}
            >
              Group {index + 1}
              {group.id === source?.id ? ' (current)' : ''}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
