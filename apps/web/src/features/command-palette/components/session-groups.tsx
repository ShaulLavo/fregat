import { CommandGroup } from '@workspace/ui/components/command'

import { SessionPaletteRow } from '@/features/command-palette/components/session-palette-row'
import { SessionProjectPaletteRow } from '@/features/command-palette/components/session-project-palette-row'
import type { SessionRailItem, SessionRailProject } from '@workspace/client-core/chat/rail/model'

type SessionGroupsProps = {
  readonly projects: readonly SessionRailProject[]
  readonly sessions: readonly SessionRailItem[]
}

/**
 * Getting back to a conversation and starting one are the same reflex a second apart, so
 * both live under the same prefix: the sessions you already have, then the projects you
 * could open a new one in.
 */
export function SessionGroups({ projects, sessions }: SessionGroupsProps) {
  return (
    <>
      <CommandGroup heading='Sessions'>
        {sessions.map((session) => (
          <SessionPaletteRow key={session.key} session={session} />
        ))}
      </CommandGroup>
      <CommandGroup heading='New session in…'>
        {projects.map((project) => (
          <SessionProjectPaletteRow key={project.key} project={project} />
        ))}
      </CommandGroup>
    </>
  )
}
