import type { ProviderInstanceId } from '@workspace/contracts'
import type { DocumentKey } from '@/lib/documents/utils/types'

export const settingsMutationKeys = {
  notificationPermission: () => ['settings', 'notification-permission'] as const,
  importSessions: (providerInstanceId: ProviderInstanceId) =>
    ['settings', 'session-import', providerInstanceId] as const,
  rawSave: (key: DocumentKey) => ['settings', 'raw-save', key] as const,
}

export const SETTINGS_RAW_SAVE_SCOPE = 'settings.raw-save'

export const SETTINGS_MUTATION_KEY = ['settings', 'mutation'] as const
