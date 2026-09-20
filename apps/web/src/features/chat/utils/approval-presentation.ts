import type { ProviderApprovalDecision } from '@workspace/contracts'
import type { PendingApprovalKind } from '@workspace/client-core/chat/pending-approvals'

export function approvalTitle(requestKind: PendingApprovalKind | null) {
  if (requestKind === 'app-access') return 'App access'
  if (requestKind === 'command') return 'Run a command'
  if (requestKind === 'file-change') return 'Apply a file change'
  if (requestKind === 'file-read') return 'Read a file'

  return 'Approval requested'
}

export function detailLabel(requestKind: PendingApprovalKind | null) {
  if (requestKind === 'app-access') return 'App access'
  if (requestKind === 'command') return 'Command'
  if (requestKind === 'file-change') return 'File change'
  if (requestKind === 'file-read') return 'File to read'

  return 'Details'
}

export function approvalDecisionVariant(decision: ProviderApprovalDecision) {
  if (decision === 'accept') return 'default'
  if (decision === 'decline') return 'destructive'
  if (decision === 'cancel') return 'ghost'
  return 'outline'
}
