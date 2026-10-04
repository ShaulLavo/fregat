import { toast } from 'sonner'
import type { EditorPlugin } from '@singapore-editor/core/extensions'

import type { FocusTargetId } from '@workspace/client-core/commands/focus'
import type { WorkspaceCommandRuntime } from '@/keymap/define-command'
import type { DocumentKey } from '@/lib/documents/utils/types'

const UNDO_BARRIER_TOAST_ID = 'editor-undo-barrier'

/**
 * A workspace edit (rename, agent edit) leaves a barrier the editor's Ctrl+Z cannot cross, and the
 * editor reports nothing when it stops there. Say so, and offer the command that does cross it.
 */
type UndoBarrierRuntime = {
  readonly documents: Pick<WorkspaceCommandRuntime['documents'], 'store'>
  readonly workspaceEdits: Pick<
    WorkspaceCommandRuntime['workspaceEdits'],
    'hasHistoryBarrier' | 'undo'
  >
}

export function notifyUndoBarrier(runtime: UndoBarrierRuntime, target: FocusTargetId): void {
  if (target.kind !== 'editor' || target.surface !== 'document') return
  const document = runtime.documents.store
    .getState()
    .getLiveEditorDocument(target.key as DocumentKey)
  if (!document || document.buffer.canUndo()) return
  if (!runtime.workspaceEdits.hasHistoryBarrier(document.buffer)) return

  toast('Undo stopped at a multi-file edit', {
    action: { label: 'Undo multi-file edit', onClick: () => void runtime.workspaceEdits.undo() },
    description:
      'A rename or other edit changed several files at once. Undo it to keep undoing in this file.',
    id: UNDO_BARRIER_TOAST_ID,
  })
}

export function createUndoBarrierPlugin(notify: () => void): EditorPlugin {
  return {
    name: 'platform.undo-barrier',
    activate(context) {
      const notified = new WeakSet<Event>()
      return context.registerViewContribution({
        createContribution(view) {
          const keymap = view.registerKeymapNode({
            element: view.scrollElement,
            context: '',
            commands: {
              undo: ({ source: event }) => {
                if (event?.type === 'keydown' && !notified.has(event)) {
                  notified.add(event)
                  notify()
                }
                return false
              },
            },
          })
          return { update: () => {}, dispose: () => keymap.dispose() }
        },
      })
    },
  }
}
