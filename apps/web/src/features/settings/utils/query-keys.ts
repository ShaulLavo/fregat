export const importSourcesQueryKey = ['settings', 'session-import', 'sources'] as const

export const settingsQueryKeys = {
  pageModule: ['settings', 'page-module'] as const,
  fontCatalog: ['fonts', 'catalog'],
  fontSample: (ref: string, text: string) => ['fonts', 'sample', ref, text] as const,
  usageHistory: (days: number, utcOffsetMinutes: number) =>
    ['providers', 'usage', 'history', days, utcOffsetMinutes] as const,
  pushDevices: ['push', 'devices'] as const,
  pushThisDevice: ['push', 'this-device'] as const,
} as const
