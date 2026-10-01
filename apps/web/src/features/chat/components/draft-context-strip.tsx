import {
  FolderIcon,
  FoldersIcon,
  GitBranchIcon,
  GitForkIcon,
  RobotIcon,
} from '@phosphor-icons/react'
import type {
  ProviderInstanceId,
  OrchestrationProjectShell,
  OrchestrationWorktreeShell,
  SessionWorktreeTarget,
} from '@workspace/contracts'
import { Spinner } from '@workspace/ui/components/spinner'
import { usePresentation } from '@workspace/ui/patterns/sheet'
import { selectChatWorktrees } from '@workspace/client-core/chat/selectors'
import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'

import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { Phase } from '@/lib/environments/components/phase'
import { basename } from '@/lib/path-formatters'
import { useMoveDraft } from '../hooks/use-move-draft'
import { useChatInputDraftStore, type ChatInputDraftTarget } from '../state/chat-input-draft-store'
import {
  draftCanChangeMachine,
  draftWorktreeChoices,
  workspaceChoiceLabel,
  type DraftMachine,
} from '../utils/draft-workspace'
import { newWorktreeTarget } from '../utils/worktree-target'
import { DraftAgentList } from './draft-agent-list'
import { DraftAgentMenu } from './draft-agent-menu'
import { DraftBranchList } from './draft-branch-list'
import { DraftBranchMenu } from './draft-branch-menu'
import { DraftMachineList } from './draft-machine-list'
import { DraftMachineMenu } from './draft-machine-menu'
import { DraftSetupSheet, type DraftSetupSection } from './draft-setup-sheet'
import { DraftWorkspaceList } from './draft-workspace-list'
import { DraftWorkspaceMenu } from './draft-workspace-menu'

const MACHINE_LOCKED =
  'Attachments and terminal captures stay on this machine. Remove them to move the draft.'
const WORKSPACE_ICONS = { current: GitBranchIcon, linked: FoldersIcon, new: GitForkIcon } as const
const ICON_CLASS = 'size-(--icon-size-sm) shrink-0'

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
  const presentation = usePresentation()
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
  const currentCheckout = movable || base.kind === 'current' ? checkout : null
  const lockedReason = canChangeMachine ? null : MACHINE_LOCKED
  const startBranch = target.kind === 'new' ? (target.baseBranch ?? base.branch ?? 'HEAD') : null

  function pinMachine() {
    if (!move.canChange()) return false
    const store = useChatInputDraftStore.getState()
    const identity = store.getDraft(draftTarget).identity
    if (identity) store.setIdentity(draftTarget, { ...identity, machineSelection: 'pinned' })
    return true
  }

  function changeTarget(next: SessionWorktreeTarget) {
    if (move.canChange()) onTarget(next)
  }

  function chooseWorktree(worktree: OrchestrationWorktreeShell) {
    if (!pinMachine()) return
    if (worktree.id === base.id) {
      changeTarget({ kind: 'current', worktreeId: base.id })
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
    if (!pinMachine()) return
    if (machine.environmentId === draftTarget.environmentId) return
    move.mutate({
      environmentId: machine.environmentId,
      projectId: machine.projectId,
      worktree: machine.worktree,
    })
  }

  function chooseStartBranch(branch: string) {
    if (target.kind === 'new') changeTarget({ ...target, baseBranch: branch })
  }

  function chooseAgent(next: string | null) {
    if (move.canChange()) onAgent(next)
  }

  if (presentation === 'sheet') {
    const choice = workspaceChoiceLabel(base, target)
    const WorkspaceIcon = git ? WORKSPACE_ICONS[choice.kind] : FolderIcon
    // Like the desktop menu, the machine shows only when there is another to move to.
    const machine =
      machines && machines.length > 1
        ? machines.find((entry) => entry.environmentId === draftTarget.environmentId)
        : undefined
    const where = git ? (startBranch ?? worktreeLabel(base, 'git')) : basename(base.path)
    const sections: DraftSetupSection[] = []
    if (machines && machine)
      sections.push({
        id: 'machine',
        label: 'Runs on',
        value: machine.label,
        icon: move.isMoving ? (
          <Spinner size='xs' label='Moving draft' />
        ) : (
          <Phase phase={machine.phase} label={machine.label} />
        ),
        disabled: move.isMoving,
        choices: (
          <DraftMachineList
            environmentId={draftTarget.environmentId}
            lockedReason={lockedReason}
            machines={machines}
            onSelect={chooseMachine}
          />
        ),
      })
    if (git)
      sections.push({
        id: 'workspace',
        label: 'Workspace',
        value: choice.label,
        detail: startBranch === null ? worktreeLabel(base, 'git') : undefined,
        icon: <WorkspaceIcon className={ICON_CLASS} />,
        disabled: move.isMoving,
        choices: (
          <DraftWorkspaceList
            base={base}
            currentCheckout={currentCheckout}
            target={target}
            worktrees={linked}
            onNew={() => changeTarget(newWorktreeTarget(base.id))}
            onWorktree={chooseWorktree}
          />
        ),
      })
    if (git && startBranch !== null)
      sections.push({
        id: 'branch',
        label: 'Starts from',
        disabled: move.isMoving,
        value: startBranch,
        mono: true,
        icon: <GitBranchIcon className={ICON_CLASS} />,
        choices: (
          <DraftBranchList rootPath={base.path} value={startBranch} onSelect={chooseStartBranch} />
        ),
      })
    sections.push({
      id: 'agent',
      label: 'Agent',
      disabled: move.isMoving,
      value: agent ?? 'Default agent',
      icon: <RobotIcon className={ICON_CLASS} />,
      choices: (
        <DraftAgentList
          cwd={base.canonicalPath}
          enabled
          providerInstanceId={providerInstanceId}
          value={agent}
          onSelect={chooseAgent}
        />
      ),
    })

    return (
      <DraftSetupSheet
        description={[machine?.label, git ? choice.label : null, where, agent ?? 'Default agent']
          .filter(Boolean)
          .join(' · ')}
        icon={
          move.isMoving ? (
            <Spinner size='xs' label='Moving draft' />
          ) : (
            <WorkspaceIcon className={ICON_CLASS} />
          )
        }
        sections={sections}
        summary={{ lead: startBranch === null ? null : 'New worktree from', where, agent }}
      />
    )
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
          lockedReason={lockedReason}
          machines={machines}
          pending={move.isMoving}
          onSelect={chooseMachine}
        />
      ) : null}
      {git ? (
        <DraftWorkspaceMenu
          base={base}
          currentCheckout={currentCheckout}
          pending={move.isMoving}
          target={target}
          worktrees={linked}
          onNew={() => changeTarget(newWorktreeTarget(base.id))}
          onWorktree={chooseWorktree}
        />
      ) : null}
      <DraftAgentMenu
        pending={move.isMoving}
        cwd={base.canonicalPath}
        providerInstanceId={providerInstanceId}
        value={agent}
        onSelect={chooseAgent}
      />
      {git ? (
        <div className='ml-auto flex min-w-0 justify-end'>
          {startBranch === null ? (
            <span
              className='text-muted-foreground flex min-w-0 items-center gap-1 px-2 text-xs'
              title={`${worktreeLabel(base, 'git')} · ${base.path}`}
            >
              <GitBranchIcon className={ICON_CLASS} />
              <span className='truncate'>{worktreeLabel(base, 'git')}</span>
            </span>
          ) : (
            <DraftBranchMenu
              pending={move.isMoving}
              rootPath={base.path}
              value={startBranch}
              onSelect={chooseStartBranch}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
