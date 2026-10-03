import { toast } from 'sonner'
import type { SettingsSnapshot } from '@workspace/contracts'

/** Delivery notices must survive rejection of an equal or stale settings snapshot. */
export function notifyPrunedSettings(snapshot: SettingsSnapshot) {
  const details = snapshot.diagnostics
    .filter((diagnostic) => diagnostic.kind === 'removed-key')
    .map((diagnostic) => diagnostic.detail)
    .filter((detail) => detail !== undefined)
  if (details.length === 0) return

  const { epoch, sequence } = snapshot.serverVersion
  const id = `settings-prune:${JSON.stringify([epoch, sequence])}`
  // Sonner retains dismissed notices across settings owner remounts.
  if (toast.getHistory().some((notice) => notice.id === id)) return
  toast.info(details.join(' '), { id })
}
