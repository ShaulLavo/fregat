import type { ProviderInstanceId } from '@workspace/contracts'
import type { DocumentKey } from '@/lib/documents/utils/types'

export const settingsMutationKeys = {
  notificationPermission: () => ['settings', 'notification-permission'] as const,
  importSessions: (providerInstanceId: ProviderInstanceId) =>
    ['settings', 'session-import', providerInstanceId] as const,
  palettes: {
    create: ['themes', 'palettes', 'create'],
    update: ['themes', 'palettes', 'update'],
    delete: ['themes', 'palettes', 'delete'],
  },
  rawSave: (key: DocumentKey) => ['settings', 'raw-save', key] as const,
}

export const SETTINGS_RAW_SAVE_SCOPE = 'settings.raw-save'

export const bundleMutationKeys = {
  omarchy: ['themes', 'bundles', 'omarchy'],
  remove: ['themes', 'bundles', 'remove'],
  create: ['themes', 'bundles', 'create'],
  import: ['themes', 'bundles', 'import'],
} as const

export const wallpaperMutationKeys = {
  upload: ['themes', 'wallpapers', 'upload'],
  remove: ['themes', 'wallpapers', 'remove'],
  import: ['themes', 'wallpapers', 'import'],
} as const

export const SETTINGS_MUTATION_KEY = ['settings', 'mutation'] as const
