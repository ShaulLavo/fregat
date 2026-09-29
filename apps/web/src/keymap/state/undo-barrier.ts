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

  toast('Undo stopped at a multi-file edit', {
    action: { label: 'Undo multi-file edit', onClick: () => void runtime.workspaceEdits.undo() },
    description:
      'A rename or other edit changed several files at once. Undo it to keep undoing in this file.',
    id: UNDO_BARRIER_TOAST_ID,
  })
}
