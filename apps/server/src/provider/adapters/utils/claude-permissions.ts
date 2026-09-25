import type {
  PermissionResult,
  PermissionRuleValue,
  PermissionUpdate,
  PermissionUpdateDestination,
} from '@anthropic-ai/claude-agent-sdk'
import type { ProviderApprovalDecision } from '@workspace/contracts'
import type { ApprovalOffer } from './approval-offers'

/** What the SDK hands `canUseTool` about how the answer may be remembered. */
export type ClaudePermissionRequest = {
  readonly suggestions?: readonly PermissionUpdate[]
  readonly suppressAlwaysAllowRule?: boolean
}

/** The only suggestions an approval may apply: they add access and change nothing else. */
type Grant =
  | Extract<PermissionUpdate, { type: 'addRules' }>
  | Extract<PermissionUpdate, { type: 'addDirectories' }>

// Claude resolves these tools' rule paths against the cwd or the settings file.
const PATH_RULE_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
  'Glob',
  'Grep',
])
const SHELL_RULE_TOOLS = new Set(['Bash', 'PowerShell'])
const RELATIVE_PATH_ARG = /(^|\s)\.{1,2}\//

const CANCELLED: PermissionResult = { behavior: 'deny', message: 'Tool use cancelled by the user.' }
const DENIED: PermissionResult = { behavior: 'deny', message: 'Tool use denied by the user.' }

/**
 * Only choices the SDK's suggestions can honour are offered. "Always" never
 * targets `projectSettings`: that file is committed and would ship to every clone.
 */
export function claudeApprovalOffers(
  request: ClaudePermissionRequest,
  toolInput: Record<string, unknown>,
): readonly ApprovalOffer<PermissionResult>[] {
  // The flag means any rule the suggestions write grants more than this ask, session rules included.
  const grants = request.suppressAlwaysAllowRule ? [] : grantsOf(request.suggestions ?? [])
  const persistent = grants.filter((grant) => grant.destination !== 'session')
  const offers: ApprovalOffer<PermissionResult>[] = [
    { option: { decision: 'cancel', label: 'Cancel' }, response: CANCELLED },
    { option: { decision: 'decline', label: 'Deny' }, response: DENIED },
  ]
  const allow = (decision: ProviderApprovalDecision, label: string, updates: PermissionUpdate[]) =>
    offers.push({ option: { decision, label }, response: allowed(toolInput, updates) })

  if (grants.length > 0)
    allow(
      'acceptForSession',
      'Allow for this session',
      grants.map((grant) => withDestination(grant, 'session')),
    )
  // A session-only set is already "for this session"; calling it "always" would lie.
  if (persistent.length > 0)
    allow('acceptAlwaysInProject', 'Always allow in this project', always(grants, 'localSettings'))
  if (persistent.length > 0 && persistent.every(isPortable))
    allow('acceptAlways', 'Always allow everywhere', always(grants, 'userSettings'))
  allow('accept', 'Allow', [])
  return offers
}

function grantsOf(suggestions: readonly PermissionUpdate[]) {
  return suggestions.filter(
    (update): update is Grant =>
      update.type === 'addDirectories' ||
      (update.type === 'addRules' && update.behavior === 'allow'),
  )
}

// Session grants stay where the SDK put them: "always" never widens what it proposed.
function always(grants: readonly Grant[], destination: PermissionUpdateDestination) {
  return grants.map((grant) =>
    grant.destination === 'session' ? grant : withDestination(grant, destination),
  )
}

function withDestination(grant: Grant, destination: PermissionUpdateDestination): Grant {
  return { ...grant, destination }
}

function allowed(
  toolInput: Record<string, unknown>,
  updates: PermissionUpdate[],
): PermissionResult {
  if (updates.length === 0) return { behavior: 'allow', updatedInput: toolInput }

  return { behavior: 'allow', updatedInput: toolInput, updatedPermissions: updates }
}

/** A grant means the same thing in user settings as where the SDK proposed it. */
function isPortable(grant: Grant) {
  if (grant.type === 'addDirectories')
    return grant.directories.every((directory) => /^(\/|~\/)/.test(directory))

  return grant.rules.every(isPortableRule)
}

// A relative path in a user-wide rule would match a different file, or run a different script, in every repository.
function isPortableRule(rule: PermissionRuleValue) {
  const content = rule.ruleContent
  if (!content) return true
  if (PATH_RULE_TOOLS.has(rule.toolName))
    return content.startsWith('//') || content.startsWith('~/')
  if (SHELL_RULE_TOOLS.has(rule.toolName)) return !RELATIVE_PATH_ARG.test(content)

  return true
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
