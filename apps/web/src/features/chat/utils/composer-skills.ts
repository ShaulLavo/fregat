import { queryOptions } from '@tanstack/react-query'
import type {
  ProviderCommandCatalog,
  ProviderInstanceId,
  ProviderSkill,
  ProviderSlashCommand,
} from '@workspace/contracts'

import { getClient, type Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { createRpcError } from '@/lib/structured-errors'

/**
 * The composer's `/command` and `$skill` source. Both live behind one route
 * because a provider answers for both in a single CLI probe — asking twice would
 * spawn the process twice.
 *
 * The probe is expensive (it starts the provider CLI and reads its
 * initialization), so the query is deliberately long-lived and must only run
 * while a menu is actually open. Skills are files under the project directory,
 * which is why `cwd` is part of the key: two projects have different skills.
 */
const COMMAND_CATALOG_STALE_TIME_MS = 5 * 60_000
const COMMAND_CATALOG_GC_TIME_MS = 30 * 60_000

export const providerCommandCatalogKeys = {
  all: ['providers', 'commands'] as const,
  catalog: (providerInstanceId: ProviderInstanceId, cwd: string | null) =>
    [...providerCommandCatalogKeys.all, providerInstanceId, cwd ?? 'no-cwd'] as const,
}

export async function fetchProviderCommandCatalog(
  providerInstanceId: ProviderInstanceId,
  cwd: string | null,
  client: Client = getClient(),
): Promise<ProviderCommandCatalog> {
  const response = await client
    .providers({ providerInstanceId })
    .commands.get({ query: cwd ? { cwd } : {} })
  if (response.error) throw createRpcError(response.error)

  return response.data as ProviderCommandCatalog
}

export function providerCommandCatalogQueryOptions({
  cwd,
  enabled,
  providerInstanceId,
}: {
  cwd: string | null
  /** Keep this false until a menu opens: a fetch spawns the provider CLI. */
  enabled: boolean
  providerInstanceId: ProviderInstanceId | null
}) {
  const instance = providerInstanceId ?? ('unknown' as ProviderInstanceId)

  return queryOptions({
    enabled: enabled && providerInstanceId !== null,
    gcTime: COMMAND_CATALOG_GC_TIME_MS,
    queryFn: ({ client }) =>
      fetchProviderCommandCatalog(instance, cwd, clientForQueryClient(client)),
    queryKey: providerCommandCatalogKeys.catalog(instance, cwd),
    refetchOnWindowFocus: false,
    staleTime: COMMAND_CATALOG_STALE_TIME_MS,
  })
}

/**
 * What committing a menu row types into the prompt. The trailing blank is what
 * separates the token from whatever the user types next; the composer's splice
 * helper already refuses to double it.
 */
export function composerSkillReplacement(skill: ProviderSkill) {
  return `$${skill.name} `
}

export function composerCommandReplacement(command: ProviderSlashCommand) {
  return `/${command.name} `
}

/** The menu row's leading text — the trigger character is part of the name here. */
export function composerSkillLabel(skill: ProviderSkill) {
  return `$${skill.name}`
}

export function composerCommandLabel(command: ProviderSlashCommand) {
  return `/${command.name}`
}

/**
 * The secondary line for a command row. The argument hint is the one piece of
 * provider copy the description never repeats, and it is what tells the user the
 * command expects something after it.
 */
export function composerCommandHint(command: ProviderSlashCommand) {
  if (!command.argumentHint) return command.description ?? ''
  if (!command.description) return command.argumentHint

  return `${command.argumentHint} — ${command.description}`
}
