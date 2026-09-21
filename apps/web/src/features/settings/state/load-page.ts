import { retryableImport } from '@/lib/retryable-import'

// The only value import of the page, so the dialog and the settings tab share one chunk.
export const loadSettingsPage = retryableImport(() => import('@/features/settings/components/page'))
