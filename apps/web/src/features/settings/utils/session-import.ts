import type { ProviderInstanceId } from '@workspace/contracts'
import type { Client } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'

export async function fetchImportSources(client: Client, signal?: AbortSignal) {
  const response = await client.orchestration['session-import'].get({ fetch: { signal } })

  return unwrapEdenResponse(response, { requireData: true }).sources
}

export async function importSessions(client: Client, providerInstanceId: ProviderInstanceId) {
  const response = await client.orchestration['session-import'].post({ providerInstanceId })

  return unwrapEdenResponse(response, { requireData: true })
}

export type ImportSource = Awaited<ReturnType<typeof fetchImportSources>>[number]
export type ImportResult = Awaited<ReturnType<typeof importSessions>>

export function importSourceName(driverKind: ImportSource['driverKind']) {
  if (driverKind === 'claude') return 'Claude Code'
  if (driverKind === 'codex') return 'Codex'

  return driverKind
}

export function importResultSummary(result: ImportResult) {
  const skipped = Object.values(result.skipped).reduce((total, count) => total + count, 0)
  const summary = `${result.imported} chats imported, ${result.refreshed} refreshed, ${result.messages} messages read.`
  if (skipped === 0) return summary

  return `${summary} ${skipped} skipped.`
}
