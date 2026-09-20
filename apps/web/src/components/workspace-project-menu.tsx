import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import {
  CaretDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  PlugsConnectedIcon,
} from '@phosphor-icons/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Phase } from '@/lib/environments/components/phase'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useCommand } from '@/keymap/hooks/use-command'

import { selectChatProjects, selectCurrentWorktree } from '@workspace/client-core/chat/selectors'
import { useEditorWorkspaceState } from '@/features/editor/state/workspace-state'
import { useProjectMenuEntries } from '@/features/workbench/hooks/use-project-menu-entries'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useOpenWorkspaceRoot } from '@/features/workspace/hooks/use-open-root'
import { NATIVE_WINDOW_NO_DRAG_CLASS } from '@/lib/platform/window-drag'
import { recentFoldersQueryOptions } from '@/lib/recent-folders-query'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { cn } from '@workspace/ui/lib/utils'

const EMPTY_FOLDERS: readonly { name: string; path: string }[] = []

export function WorkspaceProjectMenu({ workspaceTitle }: { readonly workspaceTitle: string }) {
  const { bus } = useCommand()
  const origin = originForQueryClient(useQueryClient())
  const machine = useEnvironmentsStore((state) => state.entries[origin])
  const [open, setOpen] = useState(false)
  // Lookups start when the pointer or focus reaches the trigger, so the rows are ready by the click.
  const [armed, setArmed] = useState(false)
  const wanted = open || armed
  const rootPath = useEditorWorkspaceState((state) => state.rootFolder?.path ?? null)
  const openPicker = useEditorWorkspaceState((state) => state.openPicker)
  const slice = useActiveChatProjection((state) => state)
  const projects = selectChatProjects(slice).flatMap((project) => {
    const worktree = selectCurrentWorktree(slice, project.id)
    return worktree
      ? [{ title: project.title, updatedAt: project.updatedAt, workspaceRoot: worktree.path }]
      : []
  })
  const openWorkspaceRoot = useOpenWorkspaceRoot()
  // Only fetched around the menu: recents are a menu concern, not app state.
  const recentFolders = useQuery(recentFoldersQueryOptions({ enabled: wanted }))
  const { entries, isPending } = useProjectMenuEntries({
    enabled: wanted,
    sourcesPending: recentFolders.isPending,
    activeRootPath: rootPath,
    activeTitle: workspaceTitle,
    projects,
    recentFolders: recentFolders.data ?? EMPTY_FOLDERS,
  })

  function handleSelect(nextRootPath: string) {
    if (nextRootPath === rootPath) return

    void openWorkspaceRoot(nextRootPath)
  }

  const machineSuffix = machine ? ` · ${machine.name}` : ''
  const menuTitle = rootPath ? `${rootPath}${machineSuffix}` : undefined

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Switch project'
            variant='ghost'
            className={cn(
              NATIVE_WINDOW_NO_DRAG_CLASS,
              'flex min-w-0 items-center gap-(--density-control-gap) px-(--density-row-padding-x) text-left',
            )}
            type='button'
          />
        }
        title={menuTitle}
        onPointerEnter={() => setArmed(true)}
        onPointerLeave={() => setArmed(false)}
        onFocus={() => setArmed(true)}
        onBlur={() => setArmed(false)}
      >
        <FolderOpenIcon
          className='text-muted-foreground size-(--icon-size) shrink-0'
          weight='duotone'
        />
        <span className='truncate text-xs font-medium'>{workspaceTitle}</span>
        {machine ? (
          <span className='text-muted-foreground text-3xs flex min-w-0 items-center gap-1'>
            <Phase label={machine.label ?? machine.name} phase={machine.phase} />
            <span className='truncate'>{machine.label ?? machine.name}</span>
          </span>
        ) : null}
        <CaretDownIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='max-h-[60vh] w-64 overflow-y-auto p-1'>
        <DropdownMenuRadioGroup value={rootPath ?? ''}>
          {/* Inside the group: base-ui resolves the label against its group context. */}
          <DropdownMenuLabel>Recent</DropdownMenuLabel>
          {isPending ? (
            <LoadingState label='Loading projects' className='px-2 py-1'>
              <div aria-hidden='true' className='flex items-baseline gap-1.5'>
                <div className='skeleton-sweep h-3 w-28 rounded-md' />
                <div className='skeleton-sweep h-2.5 w-16 rounded-md' />
              </div>
            </LoadingState>
          ) : null}
          {entries.map((entry) => (
            <DropdownMenuRadioItem
              key={entry.rootPath}
              title={entry.worktree ? `Worktree · ${entry.rootPath}` : entry.rootPath}
              value={entry.rootPath}
              onClick={() => handleSelect(entry.rootPath)}
            >
              {entry.worktree ? (
                <GitBranchIcon className='text-muted-foreground ml-3 size-(--icon-size-sm) shrink-0' />
              ) : null}
              <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                <span className='truncate'>{entry.title}</span>
                {(entry.worktree?.branch ?? entry.qualifier) ? (
                  <span className='text-muted-foreground text-2xs shrink-0 truncate'>
                    {entry.worktree?.branch ?? entry.qualifier}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openPicker}>
          <FolderPlusIcon className='size-(--icon-size)' />
          Open folder…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            bus.dispatch('environment.connect', {
              source: { kind: 'menu', surface: 'workspace.project' },
            })
          }}
        >
          <PlugsConnectedIcon className='size-(--icon-size)' />
          Connect machine…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
