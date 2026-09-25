export const paletteLibraryQueryKey = ['themes', 'palettes'] as const

export const bundleQueryKey = ['themes', 'bundles'] as const

export const importSourcesQueryKey = ['settings', 'session-import', 'sources'] as const

export const settingsQueryKeys = {
  pageModule: ['settings', 'page-module'] as const,
  bundleExport: (id: string) => ['themes', 'bundles', id, 'export'] as const,
  fontCatalog: ['fonts', 'catalog'],
  fontSample: (ref: string, text: string) => ['fonts', 'sample', ref, text] as const,
  usageHistory: (days: number, utcOffsetMinutes: number) =>
    ['providers', 'usage', 'history', days, utcOffsetMinutes] as const,
} as const
