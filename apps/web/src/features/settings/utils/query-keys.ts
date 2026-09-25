export const paletteLibraryQueryKey = ['themes', 'palettes'] as const

export const bundleQueryKey = ['themes', 'bundles'] as const

export const importSourcesQueryKey = ['settings', 'session-import', 'sources'] as const

export const settingsQueryKeys = {
  pageModule: ['settings', 'page-module'] as const,
  bundleExport: (id: string) => ['themes', 'bundles', id, 'export'] as const,
  nerdFonts: ['fonts', 'nerd-fonts'],
  usageHistory: (days: number, utcOffsetMinutes: number) =>
    ['providers', 'usage', 'history', days, utcOffsetMinutes] as const,
} as const
