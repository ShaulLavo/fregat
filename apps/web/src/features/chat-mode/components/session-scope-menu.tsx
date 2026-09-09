import { CaretUpDownIcon } from '@phosphor-icons/react'

import type { SessionRailProject, SessionRailScope } from '@workspace/client-core/chat/rail/model'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

const ALL_PROJECTS_VALUE = ''

export function SessionScopeMenu({
  projects,
  scope,
  scopeTitle,
  onSelectScope,
}: {
  readonly projects: readonly SessionRailProject[]
  readonly scope: SessionRailScope
  readonly scopeTitle: string
  readonly onSelectScope: (scope: SessionRailScope) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className='text-muted-foreground hover:text-foreground compact:h-6 h-7 max-w-full min-w-0 justify-start gap-1 rounded-md px-1.5 text-[11px] font-medium'
            size='sm'
            type='button'
            variant='ghost'
          >
            <span className='truncate'>{scopeTitle}</span>
            <CaretUpDownIcon className='size-3 shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent
        align='start'
        className='max-h-[60vh] w-60 overflow-y-auto rounded-md p-1'
      >
        <DropdownMenuRadioGroup value={scope ?? ALL_PROJECTS_VALUE}>
          {/* Inside the group: base-ui resolves the label against its group context. */}
          <DropdownMenuLabel>Show sessions from</DropdownMenuLabel>
          <DropdownMenuRadioItem value={ALL_PROJECTS_VALUE} onClick={() => onSelectScope(null)}>
            All projects
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              value={project.id}
              onClick={() => onSelectScope(project.id)}
            >
              <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                <span className='truncate'>{project.title}</span>
                {project.qualifier ? (
                  <span className='text-muted-foreground/70 shrink-0 truncate text-[11px]'>
                    {project.qualifier}
                  </span>
                ) : null}
              </span>
              <span className='text-muted-foreground shrink-0 text-[11px] tabular-nums'>
                {project.sessionCount}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
