import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { UsageDays } from '@/features/settings/utils/usage'
import { usageHistoryQueryOptions } from '@/features/settings/utils/usage-history-query'

/** Keeps the last range on screen while the next loads, so switching range never blanks the page. */
export function useUsageHistory(days: UsageDays) {
  const utcOffsetMinutes = -new Date().getTimezoneOffset()

  return useQuery({
    ...usageHistoryQueryOptions(days, utcOffsetMinutes),
    placeholderData: keepPreviousData,
  })
}
