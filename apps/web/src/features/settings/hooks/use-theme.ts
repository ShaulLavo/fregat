import { use } from 'react'

import { requireContext } from '@/lib/require-context'

import { ThemeContext } from '@/features/settings/providers/theme-context'

export function useTheme() {
  const context = use(ThemeContext)
  requireContext(context, 'useTheme must be used within AppearanceProvider')
  return context
}
