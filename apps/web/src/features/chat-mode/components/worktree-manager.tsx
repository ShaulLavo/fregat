import { scopedProjectKey } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { WorktreeManagerRow } from '@/features/chat-mode/components/worktree-manager-row'
import { useRailEnvironments } from '@/features/chat-mode/hooks/use-rail-environments'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'

export function WorktreeManager() {
  const ref = useWorktreeManagerStore((state) => state.project)
  const close = useWorktreeManagerStore((state) => state.closeManager)
  const open = useWorktreeManagerStore((state) => state.openManager)
  const environments = useRailEnvironments()
  const projection = useChatProjectionStore((state) =>
    ref ? selectChatProjectionSlice(state, ref.environmentId) : null,
  )
  const project = ref ? projection?.projectById[ref.projectId] : null
  const worktrees =
    projection?.worktreeIds.flatMap((id) => {
      const worktree = projection.worktreeById[id]
      return worktree?.projectId === ref?.projectId ? [worktree] : []
    }) ?? []
  return (
    <Dialog
      open={ref !== null}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent className='max-h-[80vh] max-w-xl overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>Worktrees</DialogTitle>
          <DialogDescription>
            Manage checkouts independently of sessions. Cleanup keeps branches and commits.
          </DialogDescription>
        </DialogHeader>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant='outline'>{project?.title ?? 'Choose project'}</Button>}
          />
          <DropdownMenuContent>
            {environments.flatMap((environment) =>
              environment.projects.map((project) => {
                const target = { environmentId: environment.environmentId, projectId: project.id }
                return (
                  <DropdownMenuItem key={scopedProjectKey(target)} onClick={() => open(target)}>
                    {project.title}
                    {environments.length > 1
                      ? ` · ${environment.label ?? environment.environmentId}`
                      : ''}
                  </DropdownMenuItem>
                )
              }),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {!projection?.bootstrapComplete ? <OrbitLoader label='Loading worktrees' /> : null}
        {projection?.bootstrapComplete && worktrees.length === 0 ? (
          <EmptyState
            title='No worktrees'
            description='This project has no registered checkouts.'
          />
        ) : null}
        {ref && project ? (
          <ul aria-label='Project worktrees'>
            {worktrees.map((worktree) => (
              <WorktreeManagerRow
                key={`${ref.environmentId}:${worktree.id}`}
                environmentId={ref.environmentId}
                project={project}
                worktree={worktree}
              />
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
