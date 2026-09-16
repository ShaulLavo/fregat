import { toast } from 'sonner'

import type { FocusTargetId } from '@workspace/client-core/commands/focus'
import type { WorkspaceCommandRuntime } from '@/keymap/define-command'
import type { DocumentKey } from '@/lib/documents/utils/types'

const UNDO_BARRIER_TOAST_ID = 'editor-undo-barrier'

/**
 * A workspace edit (rename, agent edit) leaves a barrier the editor's Ctrl+Z cannot cross, and the
 * editor reports nothing when it stops there. Say so, and offer the command that does cross it.
 */
export function notifyUndoBarrier(runtime: WorkspaceCommandRuntime, target: FocusTargetId): void {
  if (target.kind !== 'editor' || target.surface !== 'document') return
  const document = runtime.documents.store
    .getState()
    .getLiveEditorDocument(target.key as DocumentKey)
  if (!document || document.buffer.canUndo()) return
  if (!runtime.workspaceEdits.hasHistoryBarrier(document.buffer)) return

  toast('Undo stopped at a workspace edit', {
    action: { label: 'Undo workspace edit', onClick: () => void runtime.workspaceEdits.undo() },
    description: 'The editor history before it is restored when the workspace edit is undone.',
    id: UNDO_BARRIER_TOAST_ID,
  })
}
