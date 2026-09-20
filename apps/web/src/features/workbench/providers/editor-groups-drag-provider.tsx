import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { detectPlatform } from '@tanstack/hotkeys'
import { restrictToWindowEdges } from '@dnd-kit/modifiers'
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { useEditorGroupActions } from '@/features/editor/hooks/use-editor-group-actions'
import { useEditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import { EditorDragPreview } from '@/features/workbench/components/editor-drag-preview'
import { MoveTabToGroupDialog } from '@/features/workbench/components/move-tab-to-group-dialog'
import { useTabStripSensors } from '@/features/workbench/hooks/use-tab-strip-sensors'
import {
  EditorDragContext,
  type EditorDragState,
} from '@/features/workbench/providers/editor-drag-context'
import { editorDropPreview } from '@/features/workbench/state/editor-drop-target'
import {
  dragMode,
  dropLabel,
  editorDragCollisions,
  editorDropData,
  editorKeyboardCoordinates,
} from '@/features/workbench/utils/editor-drag'
import { allEditorGroups, groupForTab } from '@/lib/documents/utils/groups'
import { createGroupId, createSplitId, type PlacementIds } from '@/lib/documents/utils/group-types'
import { createTabId } from '@/lib/documents/utils/identity'
import { tabLabel } from '@/lib/documents/utils/labels'

type DragSession = EditorDragState & { readonly placementIds: PlacementIds }

export function EditorGroupsDragProvider({ children }: { readonly children: ReactNode }) {
  const workspace = useEditorWorkspaceStoreApi()
  const commands = useEditorGroupActions()
  const sensors = useTabStripSensors(editorKeyboardCoordinates)
  const session = useRef<DragSession | null>(null)
  const sensorPending = useRef(false)
  const lastMove = useRef<DragMoveEvent | null>(null)
  const [drag, setDrag] = useState<DragSession | null>(null)

  function publish(next: DragSession | null) {
    session.current = next
    setDrag(next)
  }

  function cancelDrag() {
    sensorPending.current = false
    lastMove.current = null
    publish(null)
  }

  function handleDragStart(event: DragStartEvent) {
    sensorPending.current = false
    const data = editorDropData(event.active.data.current)
    if (data?.kind !== 'tab') return
    publish({
      tabId: data.tabId,
      preview: null,
      copy: dragMode(event.activatorEvent, detectPlatform()) === 'copy',
      placementIds: { groupId: createGroupId(), splitId: createSplitId(), tabId: createTabId() },
    })
  }

  function handleDragMove(event: DragMoveEvent) {
    const current = session.current
    if (!current) return
    lastMove.current = event
    const preview = editorDropPreview(
      workspace.getState().workbenchPanels.editorGroups,
      current.tabId,
      event,
      current.copy ? 'copy' : 'move',
      current.placementIds,
    )
    publish({ ...current, preview })
  }

  function handleDragEnd(event: DragEndEvent) {
    const current = session.current
    cancelDrag()
    if (!current) return
    const preview = editorDropPreview(
      workspace.getState().workbenchPanels.editorGroups,
      current.tabId,
      event,
      current.copy ? 'copy' : 'move',
      current.placementIds,
    )
    if (!preview) return
    void commands.placeTab({ tabId: current.tabId, ...preview })
  }

  const onModifier = useEffectEvent((event: KeyboardEvent) => {
    const current = session.current
    if (!current) return
    const copy = dragMode(event, detectPlatform()) === 'copy'
    if (copy === current.copy) return
    publish({ ...current, copy })
    if (lastMove.current) handleDragMove(lastMove.current)
  })
  const onBlur = useEffectEvent(() => {
    if (!session.current && !sensorPending.current) return
    // dnd-kit exposes cancellation through sensor events; release its listeners too.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }))
    cancelDrag()
  })

  useEffect(() => {
    const modifier = (event: KeyboardEvent) => onModifier(event)
    const blur = () => onBlur()
    window.addEventListener('keydown', modifier)
    window.addEventListener('keyup', modifier)
    window.addEventListener('blur', blur)
    return () => {
      blur()
      window.removeEventListener('keydown', modifier)
      window.removeEventListener('keyup', modifier)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const groups = workspace.getState().workbenchPanels.editorGroups
  const tab = drag
    ? groupForTab(groups, drag.tabId)?.tabs.find((item) => item.id === drag.tabId)
    : null
  const destinationIndex = drag?.preview
    ? allEditorGroups(groups).findIndex((group) => group.id === drag.preview?.target.groupId)
    : -1

  return (
    <EditorDragContext value={tab ? drag : null}>
      <DndContext
        sensors={sensors}
        collisionDetection={editorDragCollisions}
        autoScroll={{ canScroll: (element) => element.hasAttribute('data-editor-tab-strip') }}
        accessibility={{
          restoreFocus: false,
          screenReaderInstructions: {
            draggable:
              'Press Space to pick up a tab, Left or Right to reorder, Space to drop, or Escape to cancel. Use the tab menu to split or move to another group.',
          },
          announcements: {
            onDragStart: () => `Picked up ${tab ? tabLabel(tab.content) : 'editor tab'}.`,
            onDragOver: () =>
              session.current?.preview ? dropLabel(session.current.preview) : 'No drop target.',
            onDragEnd: () => 'Tab drag finished.',
            onDragCancel: () => 'Tab drag cancelled.',
          },
        }}
        onDragStart={handleDragStart}
        onDragPending={() => {
          sensorPending.current = true
        }}
        onDragAbort={cancelDrag}
        onDragMove={handleDragMove}
        onDragOver={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={cancelDrag}
      >
        {children}
        <DragOverlay dropAnimation={null} modifiers={[restrictToWindowEdges]}>
          {drag && tab ? (
            <EditorDragPreview title={tabLabel(tab.content)} copy={drag.copy} />
          ) : null}
        </DragOverlay>
        <div className='sr-only' role='status' aria-live='polite'>
          {tab && drag?.preview && destinationIndex >= 0
            ? `Group ${destinationIndex + 1}: ${dropLabel(drag.preview)}`
            : null}
        </div>
      </DndContext>
      <MoveTabToGroupDialog />
    </EditorDragContext>
  )
}
