import { platformCommands, type CommandEntry } from './table'
import type { PlatformCommandId } from './types'

export type CommandSpec<Id extends PlatformCommandId = PlatformCommandId> = {
  readonly aliases?: readonly string[]
  readonly id: Id
  readonly title: string
  readonly category: string
  readonly description?: string
  readonly vscodeCommandIds?: readonly string[]
}

export const platformCommandSpecs: readonly CommandSpec[] = platformCommands.map(commandSpec)

export function platformCommandSpec(command: PlatformCommandId): CommandSpec | null {
  return platformCommandSpecById.get(command) ?? null
}

const platformCommandSpecById = new Map(platformCommandSpecs.map((spec) => [spec.id, spec]))

/** The palette's view of a command: what it is called, not what it does. */
function commandSpec(command: CommandEntry): CommandSpec {
  return {
    category: command.category,
    id: command.id,
    title: command.title,
    ...(command.aliases ? { aliases: command.aliases } : {}),
    ...(command.description ? { description: command.description } : {}),
    ...(command.vscodeCommandIds ? { vscodeCommandIds: command.vscodeCommandIds } : {}),
  }
}
