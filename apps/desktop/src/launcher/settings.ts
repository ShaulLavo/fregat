import { requestOriginHeaders } from '../../../../scripts/runtime-network'
import { isRecord } from '@workspace/utils/objects'
import { startupBudget } from './startup'
import { nativeBudget } from './native-helper'

export async function readSettings(
  server: string,
  webUrl: string,
  options: {
    signal: AbortSignal
    fetcher?: (input: string, init: RequestInit) => Promise<Response>
    onWarning: (context: Record<string, unknown>) => void
  },
) {
  const requestSignal = AbortSignal.any([options.signal, AbortSignal.timeout(1500)])
  let status: number | undefined
  let reason = 'fetch-failed'
  try {
    const response = await (options.fetcher ?? fetch)(`${server}/settings`, {
      headers: requestOriginHeaders(webUrl),
      signal: requestSignal,
    })
    status = response.status
    if (!response.ok) {
      reason = 'http-failure'
    } else {
      reason = 'invalid-json'
      const snapshot: unknown = await response.json()
      if (isRecord(snapshot) && isRecord(snapshot.values)) {
        return {
          browser: snapshot.values['window.browser'] ?? 'auto',
          transparency: snapshot.values['window.transparency'] ?? 'compositor',
          startup: startupBudget(snapshot.values),
          native: nativeBudget(snapshot.values),
        }
      }
      reason = 'invalid-response'
    }
  } catch {
    options.signal.throwIfAborted()
    if (requestSignal.aborted) reason = 'timeout'
  }
  options.onWarning({ status, reason })
  return {
    browser: 'auto',
    transparency: 'compositor',
    startup: startupBudget(),
    native: nativeBudget(),
  }
}
