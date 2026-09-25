import type {
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
} from '@anthropic-ai/claude-agent-sdk'
import type { ProviderApprovalDecision, ProviderApprovalOption } from '@workspace/contracts'

/** What the SDK hands `canUseTool` about how the answer may be remembered. */
export type ClaudePermissionRequest = {
  readonly suggestions?: readonly PermissionUpdate[]
  readonly suppressAlwaysAllowRule?: boolean
}

/**
 * Never `projectSettings`: that file is committed, so a rule written there
 * would ship to everyone who clones the repository.
 */
const ALWAYS_DESTINATIONS = {
  acceptAlways: 'userSettings',
  acceptAlwaysInProject: 'localSettings',
} as const satisfies Partial<Record<ProviderApprovalDecision, PermissionUpdateDestination>>

/** Only decisions the SDK's suggestions can honour are offered. */
export function claudeApprovalOptions(
  request: ClaudePermissionRequest,
): readonly ProviderApprovalOption[] {
  const suggestions = request.suggestions ?? []
  const options: ProviderApprovalOption[] = [
    { decision: 'cancel', label: 'Cancel' },
    { decision: 'decline', label: 'Deny' },
  ]
  if (suggestions.length > 0)
    options.push({ decision: 'acceptForSession', label: 'Allow for this session' })
  if (offersAlwaysRule(request, suggestions)) {
    options.push(
      { decision: 'acceptAlwaysInProject', label: 'Always allow in this project' },
      { decision: 'acceptAlways', label: 'Always allow everywhere' },
    )
  }
  options.push({ decision: 'accept', label: 'Allow' })
  return options
}

// A suggestion set that is session-only already is "for this session"; calling it "always" would lie.
function offersAlwaysRule(
  request: ClaudePermissionRequest,
  suggestions: readonly PermissionUpdate[],
) {
  if (request.suppressAlwaysAllowRule) return false

  return suggestions.some((update) => update.destination !== 'session')
}

export function claudePermissionResult(
  decision: ProviderApprovalDecision,
  toolInput: Record<string, unknown>,
  suggestions: readonly PermissionUpdate[],
): PermissionResult {
  if (decision === 'cancel') return { behavior: 'deny', message: 'Tool use cancelled by the user.' }
  if (decision === 'decline') return { behavior: 'deny', message: 'Tool use denied by the user.' }

  const updatedPermissions = claudePermissionUpdates(decision, suggestions)
  if (updatedPermissions.length === 0) return { behavior: 'allow', updatedInput: toolInput }

  return { behavior: 'allow', updatedInput: toolInput, updatedPermissions }
}

/**
 * "Always" keeps the updates the SDK scoped to the session where it put them and
 * moves only the persistent ones, so it never widens what the harness proposed.
 */
export function claudePermissionUpdates(
  decision: ProviderApprovalDecision,
  suggestions: readonly PermissionUpdate[],
): PermissionUpdate[] {
  if (decision === 'acceptForSession')
    return suggestions.map((update) => withDestination(update, 'session'))
  if (decision !== 'acceptAlways' && decision !== 'acceptAlwaysInProject') return []

  const destination = ALWAYS_DESTINATIONS[decision]
  return suggestions.map((update) =>
    update.destination === 'session' ? update : withDestination(update, destination),
  )
}

function withDestination(
  update: PermissionUpdate,
  destination: PermissionUpdateDestination,
): PermissionUpdate {
  return { ...update, destination }
}

/** Rule and directory entries written, for the wide event; never the rules themselves. */
export function claudePermissionUpdateCount(updates: readonly PermissionUpdate[]) {
  let count = 0
  for (const update of updates) {
    if (update.type === 'setMode') {
      count += 1
      continue
    }
    count += 'rules' in update ? update.rules.length : update.directories.length
  }
  return count
}
