import type { ChatInputDraft } from '@/features/chat/state/chat-input-draft-store'
import type { EnvironmentPhase } from '@workspace/client-core/environments/utils/connection'
import type {
  EnvironmentId,
  GitBranch,
  OrchestrationWorktreeShell,
  ProjectId,
  SessionWorktreeTarget,
  WorktreeId,
} from '@workspace/contracts'

/** Another machine's checkout of the same repository, as the draft could move there. */
export type DraftMachine = {
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId
  readonly label: string
  readonly phase: EnvironmentPhase
  /** The machine's main checkout; null when it is not ready to take a draft. */
  readonly worktree: { readonly id: WorktreeId; readonly path: string } | null
}

/** Linked worktrees a draft can sit on: ready ones, newest first. */
export function draftWorktreeChoices(
  worktrees: readonly OrchestrationWorktreeShell[],
  projectId: ProjectId,
) {
  return worktrees
    .filter(
      (worktree) =>
        worktree.projectId === projectId &&
        worktree.kind === 'linked' &&
        worktree.lifecycle.state === 'ready',
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

/** What the workspace trigger says: where the session will run. */
const WORKSPACE_CHOICE = {
  new: 'New worktree',
  linked: 'Worktree',
  current: 'Current checkout',
} as const

/** Every label the workspace trigger can show, so it can hold the widest one's width. */
export const WORKSPACE_CHOICE_LABELS: readonly string[] = Object.values(WORKSPACE_CHOICE)

export function workspaceChoiceLabel(
  base: Pick<OrchestrationWorktreeShell, 'kind'>,
  target: Pick<SessionWorktreeTarget, 'kind'>,
) {
  if (target.kind === 'new') return { kind: 'new', label: WORKSPACE_CHOICE.new } as const
  if (base.kind === 'linked') return { kind: 'linked', label: WORKSPACE_CHOICE.linked } as const
  return { kind: 'current', label: WORKSPACE_CHOICE.current } as const
}

/**
 * Branches a new worktree may start from. `worktree/…` branches belong to
 * worktrees the app made; those are offered as worktrees, not as bases.
 */
export function baseBranchChoices(branches: readonly GitBranch[]) {
  return branches
    .filter((branch) => !branch.name.startsWith('worktree/'))
    .toSorted((left, right) => Number(right.current) - Number(left.current))
}

/** Attachments and terminal captures belong to the machine that made them. */
export function draftCanChangeMachine(
  draft: Pick<ChatInputDraft, 'attachments' | 'terminalContexts'>,
) {
  return draft.attachments.length === 0 && draft.terminalContexts.length === 0
}
