import { errorMessage } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import { startupBudget } from './startup'
import { nativeBudget } from './native-helper'

export async function readSettings(
  server: string,
  origin: string,
  options: {
    signal: AbortSignal
    fetcher?: typeof fetch
    onUnreachable: (context: Record<string, unknown>) => void
  },
) {
  try {
    const response = await (options.fetcher ?? fetch)(`${server}/settings`, {
      headers: { Origin: origin },
      signal: options.signal,
    })
    const snapshot: unknown = await response.json()
    if (!response.ok || !isRecord(snapshot) || !isRecord(snapshot.values))
      return {
        browser: 'auto',
        transparency: 'compositor',
        startup: startupBudget(),
        native: nativeBudget(),
      }
    return {
      browser: snapshot.values['window.browser'] ?? 'auto',
      transparency: snapshot.values['window.transparency'] ?? 'compositor',
      startup: startupBudget(snapshot.values),
      native: nativeBudget(snapshot.values),
    }
  } catch (error) {
    options.signal.throwIfAborted()
    options.onUnreachable({ error: errorMessage(error) })
    return {
      browser: 'auto',
      transparency: 'compositor',
      startup: startupBudget(),
      native: nativeBudget(),
    }
  }
}
