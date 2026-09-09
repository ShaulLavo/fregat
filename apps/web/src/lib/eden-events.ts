import { normalizeEdenDates } from '@workspace/client-core/transport/normalize-dates'
import { createClientInvariantError } from '@/lib/structured-errors'

import { createRpcError } from './structured-errors'

export type UnwrapEdenOptions = {
  /** Throw when `data` is null/undefined instead of returning it. */
  requireData?: boolean
  /**
   * Turn Eden's revived `Date` objects back into the ISO strings the contracts
   * declare. Required before any Valibot re-parse — Eden revives every
   * date-shaped string on the way out, so the schema sees a `Date` and rejects.
   */
  normalizeDates?: boolean
  /** Error message used when `requireData` rejects empty data. */
  emptyMessage?: string
}

export function unwrapEdenResponse<T>(
  response: { data?: T | null; error?: unknown },
  options: UnwrapEdenOptions = {},
): T {
  if (response.error) throw createRpcError(response.error)
  if (options.requireData && response.data == null)
    throw createClientInvariantError(options.emptyMessage ?? 'server returned an empty response')

  const data = options.normalizeDates ? normalizeEdenDates(response.data) : response.data

  return data as T
}
