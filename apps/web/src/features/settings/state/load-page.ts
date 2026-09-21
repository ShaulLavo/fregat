import { retryableImport } from '@/lib/retryable-import'

let loaded: typeof import('@/features/settings/components/page') | undefined

// Both hosts share the chunk; warm boot can consume it without a Suspense pass.
export const loadSettingsPage = retryableImport(async () => {
  loaded = await import('@/features/settings/components/page')
  return loaded
})

export function loadedSettingsPage() {
  return loaded
}
