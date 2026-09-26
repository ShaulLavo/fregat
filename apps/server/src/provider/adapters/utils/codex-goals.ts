import type {
  ProviderGoalAction,
  ProviderSlashCommand,
  ProviderSessionGoal,
  ProviderSessionGoalStatus,
} from '@workspace/contracts'
import type { CodexThreadGoal } from '../codex-protocol'

/** What a `/goal` prompt asks of a Codex thread; the app-server has no slash commands. */
export type CodexGoalCommand =
  | { readonly kind: 'show' }
  | { readonly kind: 'action'; readonly action: ProviderGoalAction }
  | { readonly kind: 'objective'; readonly objective: string }

/** The one command Platform answers for Codex, which offers none over the app-server. */
export const CODEX_GOAL_COMMAND: ProviderSlashCommand = {
  argumentHint: '<objective> | pause | resume | clear',
  description: 'Set a goal Codex keeps working toward across turns',
  name: 'goal',
}

const ACTIONS: ReadonlySet<string> = new Set<ProviderGoalAction>(['pause', 'resume', 'clear'])

export function codexGoalCommand(text: string): CodexGoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  const argument = (match[1] ?? '').trim()
  if (!argument) return { kind: 'show' }
  const action = argument.toLowerCase()
  if (ACTIONS.has(action)) return { kind: 'action', action: action as ProviderGoalAction }
  return { kind: 'objective', objective: argument }
}

const STATUSES: Record<string, ProviderSessionGoalStatus> = {
  active: 'active',
  paused: 'paused',
  blocked: 'blocked',
  usageLimited: 'usage-limited',
  budgetLimited: 'budget-limited',
  complete: 'complete',
}

export function codexSessionGoal(goal: CodexThreadGoal): ProviderSessionGoal {
  return {
    objective: goal.objective,
    // A status newer than this build still names a goal that exists; blocked is the safe read.
    status: STATUSES[goal.status] ?? 'blocked',
    tokenBudget: goal.tokenBudget ?? null,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    iterations: null,
    lastReason: null,
  }
}

/** The reply a `/goal` turn shows when no model turn answers it. */
export function codexGoalReply(command: CodexGoalCommand, goal: ProviderSessionGoal | null) {
  if (command.kind === 'objective') return `Goal set: ${command.objective}`
  if (command.kind === 'action' && command.action === 'clear') return 'Goal cleared.'
  if (!goal) return 'No goal is set.'
  return `Goal (${goal.status}): ${goal.objective}`
}
