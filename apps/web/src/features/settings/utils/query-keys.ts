export const paletteLibraryQueryKey = ['themes', 'palettes'] as const

export const bundleQueryKey = ['themes', 'bundles'] as const

export const importSourcesQueryKey = ['settings', 'session-import', 'sources'] as const

export const settingsQueryKeys = {
  bundleExport: (id: string) => ['themes', 'bundles', id, 'export'] as const,
  nerdFonts: ['fonts', 'nerd-fonts'],
} as const
