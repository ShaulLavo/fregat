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
import { sessionProjectRowTitle } from '@/features/command-palette/utils/query'

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
  const scoped = projects.find((project) => project.id === scope)
  const scopeDetail = scoped ? sessionProjectRowTitle(scoped) : scopeTitle

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className='text-muted-foreground hover:text-foreground text-2xs max-w-full min-w-0 justify-start gap-1 px-1.5 font-medium'
            size='sm'
            title={scopeDetail}
            type='button'
            variant='ghost'
          >
            <span className='truncate'>{scopeTitle}</span>
            <CaretUpDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='max-h-[60vh] w-60 overflow-y-auto p-1'>
        <DropdownMenuRadioGroup value={scope ?? ALL_PROJECTS_VALUE}>
          {/* Inside the group: base-ui resolves the label against its group context. */}
          <DropdownMenuLabel>Show sessions from</DropdownMenuLabel>
          <DropdownMenuRadioItem value={ALL_PROJECTS_VALUE} onClick={() => onSelectScope(null)}>
            All projects
          </DropdownMenuRadioItem>
          {projects.map((project) => (
            <DropdownMenuRadioItem
              key={project.id}
              title={sessionProjectRowTitle(project)}
              value={project.id}
              onClick={() => onSelectScope(project.id)}
            >
              <span className='flex min-w-0 flex-1 items-baseline gap-1.5'>
                <span className='truncate'>{project.title}</span>
                {project.qualifier ? (
                  <span className='text-muted-foreground text-2xs shrink-0 truncate'>
                    {project.qualifier}
                  </span>
                ) : null}
              </span>
              <span className='text-muted-foreground text-2xs shrink-0 tabular-nums'>
                {project.sessionCount}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
