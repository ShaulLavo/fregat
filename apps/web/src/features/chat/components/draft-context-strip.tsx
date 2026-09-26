import { GitBranchIcon } from '@phosphor-icons/react'
import type {
  ProviderInstanceId,
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  SessionWorktreeTarget,
} from '@workspace/contracts'
import { selectChatWorktrees } from '@workspace/client-core/chat/selectors'
import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'

import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useMoveDraft } from '../hooks/use-move-draft'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import {
  draftCanChangeMachine,
  draftWorktreeChoices,
  type DraftMachine,
} from '../utils/draft-workspace'
import { newWorktreeTarget } from '../utils/worktree-target'
import { DraftAgentMenu } from './draft-agent-menu'
import { DraftBranchMenu } from './draft-branch-menu'
import { DraftMachineMenu } from './draft-machine-menu'
import { DraftWorkspaceMenu } from './draft-workspace-menu'

const MACHINE_LOCKED =
  'Attachments and terminal captures stay on this machine. Remove them to move the draft.'

/** Where the new session will run: machine, workspace and branch, under the composer. */
export function DraftContextStrip({
  agent,
  providerInstanceId,
  onAgent,
  draftTarget,
  project,
  base,
  target,
  machines,
  onTarget,
}: {
  readonly agent: string | null
  /** Whose agent definitions the picker lists: the draft's selected model provider. */
  readonly providerInstanceId: ProviderInstanceId | null
  readonly onAgent: (agent: string | null) => void
  readonly draftTarget: ChatInputDraftTarget
  readonly project: OrchestrationProjectShell
  readonly base: OrchestrationWorktreeShell
  readonly target: SessionWorktreeTarget
  /** Null when the draft cannot leave its surface: the sidebar chat follows the editor. */
  readonly machines: readonly DraftMachine[] | null
  readonly onTarget: (target: SessionWorktreeTarget) => void
}) {
  const worktrees = useChatProjectionStore((state) =>
    selectChatWorktrees(selectChatProjectionSlice(state, draftTarget.environmentId)),
  )
  const canChangeMachine = useChatInputDraftStore((state) =>
    draftCanChangeMachine(state.getDraft(draftTarget)),
  )
  const move = useMoveDraft(draftTarget)
  const git = project.repositoryKind === 'git'
  const movable = machines !== null
  const checkout =
    worktrees.find(
      (worktree) => worktree.projectId === project.id && worktree.kind === 'current',
    ) ?? null
  // The sidebar chat cannot move, so it lists only the worktree it already sits on.
  const linked = draftWorktreeChoices(movable ? worktrees : [base], project.id)

  function chooseWorktree(worktree: OrchestrationWorktreeShell) {
    if (worktree.id === base.id) {
      onTarget({ kind: 'current', worktreeId: base.id })
      return
    }
    move.mutate({
      environmentId: draftTarget.environmentId,
      projectId: project.id,
      worktree: { id: worktree.id, path: worktree.path },
    })
  }

  function chooseMachine(machine: DraftMachine) {
    if (!machine.worktree) return
    move.mutate({
      environmentId: machine.environmentId,
      projectId: machine.projectId,
      worktree: machine.worktree,
    })
  }

  return (
    <div
      aria-label='Session workspace'
      className='flex min-w-0 items-center gap-1 pt-1'
      role='group'
    >
      {machines ? (
        <DraftMachineMenu
          environmentId={draftTarget.environmentId}
          lockedReason={canChangeMachine ? null : MACHINE_LOCKED}
          machines={machines}
          pending={move.isPending}
          onSelect={chooseMachine}
        />
      ) : null}
      {git ? (
        <DraftWorkspaceMenu
          base={base}
          currentCheckout={movable || base.kind === 'current' ? checkout : null}
          pending={move.isPending}
          target={target}
          worktrees={linked}
          onNew={() => onTarget(newWorktreeTarget(base.id))}
          onWorktree={chooseWorktree}
        />
      ) : null}
      <DraftAgentMenu
        cwd={base.canonicalPath}
        providerInstanceId={providerInstanceId}
        value={agent}
        onSelect={onAgent}
      />
      {git ? (
        <div className='ml-auto flex min-w-0 justify-end'>
          {target.kind === 'new' ? (
            <DraftBranchMenu
              rootPath={base.path}
              value={target.baseBranch ?? base.branch ?? 'HEAD'}
              onSelect={(branch) => onTarget({ ...target, baseBranch: branch })}
            />
          ) : (
            <span
              className='text-muted-foreground flex min-w-0 items-center gap-1 px-2 text-xs'
              title={`${worktreeLabel(base, 'git')} · ${base.path}`}
            >
              <GitBranchIcon className='size-(--icon-size-sm) shrink-0' />
              <span className='truncate'>{worktreeLabel(base, 'git')}</span>
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
