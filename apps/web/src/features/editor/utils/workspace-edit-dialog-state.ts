import type { WorkspaceEditServiceSnapshot } from '@/features/editor/state/workspace-edit-service'

export function selectWorkspaceEditPreview(
  snapshot: WorkspaceEditServiceSnapshot,
): WorkspaceEditServiceSnapshot | null {
  switch (snapshot.phase) {
    case 'preparing':
    case 'awaiting-confirmation':
    case 'committing':
    case 'finalizing':
    case 'stale':
      return snapshot
    default:
      return null
  }
}

export function selectWorkspaceEditRecovery(
  snapshot: WorkspaceEditServiceSnapshot,
): WorkspaceEditServiceSnapshot | null {
  if (!snapshot.recovery) return null
  switch (snapshot.phase) {
    case 'recovery-required':
    case 'recovering':
    case 'releasing-recovery':
    case 'released':
      return snapshot
    default:
      return null
  }
}
