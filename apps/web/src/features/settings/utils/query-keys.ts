export const importSourcesQueryKey = ['settings', 'session-import', 'sources'] as const

export const settingsQueryKeys = {
  pageModule: ['settings', 'page-module'] as const,
  fontCatalog: ['fonts', 'catalog'],
  fontSample: (ref: string, text: string) => ['fonts', 'sample', ref, text] as const,
  providerUpdate: (providerInstanceId: string) =>
    ['providers', providerInstanceId, 'update'] as const,
  usageHistoryAll: ['providers', 'usage', 'history'] as const,
  usageHistory: (days: number, utcOffsetMinutes: number) =>
    ['providers', 'usage', 'history', days, utcOffsetMinutes] as const,
  mcpServersAll: ['providers', 'mcp-config'] as const,
  mcpServers: (providerInstanceId: string, folder: string | null) =>
    ['providers', 'mcp-config', providerInstanceId, folder ?? '~'] as const,
  pushDevices: ['push', 'devices'] as const,
  pushThisDevice: ['push', 'this-device'] as const,
  pairingStatus: ['pairing', 'status'] as const,
  pairedDevices: ['pairing', 'devices'] as const,
} as const
