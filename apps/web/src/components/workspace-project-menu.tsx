import { useActiveChatProjection } from '@/features/chat/hooks/use-active-projection'
import {
  CaretDownIcon,
  FolderOpenIcon,
  FolderPlusIcon,
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
  // Only fetched while the menu is open: recents are a menu concern, not app state.
  const recentFolders = useQuery(recentFoldersQueryOptions({ enabled: open }))
  const { entries, isPending } = useProjectMenuEntries({
    enabled: open,
    activeRootPath: rootPath,
    activeTitle: workspaceTitle,
    projects,
    recentFolders: recentFolders.data ?? EMPTY_FOLDERS,
  })

  function handleSelect(nextRootPath: string) {
    if (nextRootPath === rootPath) return

    void openWorkspaceRoot(nextRootPath)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Switch project'
            variant='ghost'
            className={cn(
              NATIVE_WINDOW_NO_DRAG_CLASS,
              'hover:bg-accent focus-visible:ring-ring/50 compact:gap-1.5 compact:px-1.5 compact:py-0.5 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-1',
            )}
            type='button'
          />
        }
      >
        <FolderOpenIcon className='text-muted-foreground size-4 shrink-0' weight='duotone' />
        <span className='truncate text-xs font-medium'>{workspaceTitle}</span>
        {machine ? (
          <span className='text-muted-foreground flex min-w-0 items-center gap-1 text-[10px]'>
            <Phase label={machine.label ?? machine.name} phase={machine.phase} />
            <span className='truncate'>{machine.label ?? machine.name}</span>
          </span>
        ) : null}
        <CaretDownIcon className='text-muted-foreground size-3 shrink-0' />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='max-h-[60vh] w-64 overflow-y-auto rounded-md p-1'
      >
        <DropdownMenuRadioGroup value={rootPath ?? ''}>
          {/* Inside the group: base-ui resolves the label against its group context. */}
          <DropdownMenuLabel>Recent</DropdownMenuLabel>
          {recentFolders.isPending || isPending ? (
            <LoadingState label='Loading projects' className='px-2 py-1'>
              <div aria-hidden='true' className='skeleton-sweep h-4 w-full rounded-sm' />
            </LoadingState>
          ) : null}
          {entries.map((entry) => (
            <DropdownMenuRadioItem
              key={entry.rootPath}
              value={entry.rootPath}
              onClick={() => handleSelect(entry.rootPath)}
            >
              <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                <span className='truncate'>{entry.title}</span>
                {entry.qualifier ? (
                  <span className='text-muted-foreground/70 shrink-0 truncate text-[11px]'>
                    {entry.qualifier}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={openPicker}>
          <FolderPlusIcon className='size-4' />
          Open folder…
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            bus.dispatch('environment.connect', {
              source: { kind: 'menu', surface: 'workspace.project' },
            })
          }}
        >
          <PlugsConnectedIcon className='size-4' />
          Connect machine…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
