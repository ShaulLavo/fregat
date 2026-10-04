import { queryOptions } from '@tanstack/react-query'
import { addressQueryKeys } from '@/features/address/utils/query-keys'

export const settingsCategoriesQueryOptions = queryOptions({
  queryKey: addressQueryKeys.settingsCategories,
  queryFn: async () => {
    const { SETTING_CATEGORIES } = await import('@workspace/contracts/settings/presentation')
    return SETTING_CATEGORIES
  },
  staleTime: 'static',
  gcTime: Infinity,
  networkMode: 'always',
})
