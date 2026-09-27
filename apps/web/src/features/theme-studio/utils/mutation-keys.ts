export const paletteMutationKeys = {
  all: ['themes', 'palettes'],
  create: ['themes', 'palettes', 'create'],
  update: ['themes', 'palettes', 'update'],
  delete: ['themes', 'palettes', 'delete'],
} as const

export const bundleMutationKeys = {
  all: ['themes', 'bundles'],
  remove: ['themes', 'bundles', 'remove'],
  create: ['themes', 'bundles', 'create'],
  import: ['themes', 'bundles', 'import'],
} as const
