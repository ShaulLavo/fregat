import type { ProviderInstanceId } from '@workspace/contracts'
import type { DocumentKey } from '@/lib/documents/utils/types'

export const settingsMutationKeys = {
  keybindings: ['settings', 'mutation', 'keybindings'] as const,
  notificationPermission: () => ['settings', 'notification-permission'] as const,
  importSessions: (providerInstanceId: ProviderInstanceId) =>
    ['settings', 'session-import', providerInstanceId] as const,
  providerUpdate: (providerInstanceId: ProviderInstanceId) =>
    ['settings', 'provider-update', providerInstanceId] as const,
  rawSave: (key: DocumentKey) => ['settings', 'raw-save', key] as const,
  mcp: {
    add: (providerInstanceId: ProviderInstanceId) =>
      ['settings', 'mcp', 'add', providerInstanceId] as const,
    remove: (providerInstanceId: ProviderInstanceId, name: string) =>
      ['settings', 'mcp', 'remove', providerInstanceId, name] as const,
    copy: (providerInstanceId: ProviderInstanceId, name: string) =>
      ['settings', 'mcp', 'copy', providerInstanceId, name] as const,
    signIn: (providerInstanceId: ProviderInstanceId, name: string) =>
      ['settings', 'mcp', 'sign-in', providerInstanceId, name] as const,
  },
  pairing: {
    link: ['pairing', 'link'] as const,
    remove: (deviceId: string) => ['pairing', 'remove', deviceId] as const,
  },
  push: {
    subscribe: ['push', 'subscribe'] as const,
    test: (deviceId: string) => ['push', 'test', deviceId] as const,
    remove: (deviceId: string) => ['push', 'remove', deviceId] as const,
  },
}

export const SETTINGS_RAW_SAVE_SCOPE = 'settings.raw-save'

export const SETTINGS_MUTATION_KEY = ['settings', 'mutation'] as const
