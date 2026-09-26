import { log } from '@/lib/client-logging'
import { forgetCachedEnvironment } from '@/lib/environments/state/binding-cache'

const RELOADED_FOR = 'platform.environments.identity-reload'

/**
 * The server that serves this page owns its identity: a new one means its database was replaced.
 * Deletes what this browser kept for the old identity and reloads, so the next boot starts clean.
 */
export function replacePrimaryIdentity(
  expected: string,
  received: string,
  {
    reload = () => window.location.reload(),
    asked = false,
  }: {
    readonly reload?: () => void
    /** The person chose Trust replacement, so a repeated replacement reloads again. */
    readonly asked?: boolean
  } = {},
): boolean {
  const outcome = replacementOutcome(forgetCachedEnvironment(expected), received, asked)
  log.warn({
    action: 'environment.identity.replace',
    area: 'environments',
    machine: 'local',
    expected,
    received,
    outcome,
  })
  if (outcome !== 'reload') return false
  writeReloadedFor(received)
  // Stores flush drafts on beforeunload; pagehide runs after them and deletes what they wrote.
  window.addEventListener('pagehide', () => forgetCachedEnvironment(expected), { once: true })
  reload()
  return true
}

function replacementOutcome(forgotten: boolean, received: string, asked: boolean) {
  if (!forgotten) return 'storage-kept'
  // A server whose health and handshake disagree would otherwise reload this tab forever.
  if (!asked && readReloadedFor() === received) return 'repeated'
  return 'reload'
}

function readReloadedFor() {
  try {
    return sessionStorage.getItem(RELOADED_FOR)
  } catch {
    return null
  }
}

function writeReloadedFor(received: string) {
  try {
    sessionStorage.setItem(RELOADED_FOR, received)
  } catch {
    return
  }
}
