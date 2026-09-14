import type { DocumentKey } from '@/lib/documents/utils/types'

export const settingsMutationKeys = {
  rawSave: (key: DocumentKey) => ['settings', 'raw-save', key] as const,
}

export const SETTINGS_RAW_SAVE_SCOPE = 'settings.raw-save'
