import path from 'node:path'
import { parsePickerPathInput } from '@workspace/client-core/files/path-input'
import { readServerPaths, readDirectory } from '@workspace/client-core/files/read'
import {
  activeComposerMention,
  serializeComposerMention,
  type ModelSelection,
} from '@workspace/contracts'
import type { SettingsSession } from '@/connection/state/session'
import { createTuiError } from '@/host/utils/structured-errors'

export type Completion = {
  readonly label: string
  readonly description: string
  readonly text: string
}
export async function readCompletions({
  session,
  text,
  cwd,
  selection,
  signal,
}: {
  readonly session: SettingsSession
  readonly text: string
  readonly cwd: string
  readonly selection: ModelSelection | null
  readonly signal: AbortSignal
}): Promise<readonly Completion[]> {
  const mention = activeComposerMention(text, text.length)
  if (mention)
    return fileCompletions({
      session,
      cwd,
      query: mention.query,
      prefix: text.slice(0, mention.start),
      signal,
    })
  const match = /(?:^|\s)([/$])([^\s]*)$/.exec(text)
  if (!match) return []
  const trigger = match[1]
  const query = match[2] ?? ''
  const prefix = text.slice(0, text.length - query.length - 1)
  if (!selection) return []
  const response = await session.client
    .providers({ providerInstanceId: selection.providerInstanceId })
    .commands.get({ query: { cwd }, fetch: { signal } })
  if (response.error)
    throw createTuiError('Could not read provider commands.', 'Reconnect and try completion again.')
  const catalog = response.data
  const options =
    trigger === '$' ? catalog.skills.filter((skill) => skill.enabled) : catalog.commands
  return options
    .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
    .map((item) => ({
      label: `${trigger}${item.name}`,
      description: item.description ?? '',
      text: `${prefix}${trigger}${item.name} `,
    }))
}

async function fileCompletions({
  session,
  cwd,
  query,
  prefix,
  signal,
}: {
  readonly session: SettingsSession
  readonly cwd: string
  readonly query: string
  readonly prefix: string
  readonly signal: AbortSignal
}): Promise<readonly Completion[]> {
  const parent = query.includes('/') ? query.slice(0, query.lastIndexOf('/') + 1) : ''
  const name = query.slice(parent.length).toLowerCase()
  const paths = await readServerPaths({ client: session.client, signal })
  const parsed = parsePickerPathInput(path.posix.join(cwd, parent), paths)
  if (parsed.error !== null)
    throw createTuiError(parsed.error, 'Choose a file in the available filesystem.')
  const result = await readDirectory({ client: session.client, path: parsed.path, signal })
  return result.entries
    .filter((entry) => entry.name.toLowerCase().includes(name))
    .map((entry) => ({
      label: `@${parent}${entry.name}`,
      description: entry.type,
      text: `${prefix}${serializeComposerMention(`${parent}${entry.name}`)} `,
    }))
}
