export const bundleQueryKey = ['themes', 'bundles'] as const
export const bundleMutationKeys = {
  omarchy: ['themes', 'bundles', 'omarchy'],
  remove: ['themes', 'bundles', 'remove'],
  create: ['themes', 'bundles', 'create'],
  import: ['themes', 'bundles', 'import'],
} as const
