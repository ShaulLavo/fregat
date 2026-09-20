import type { ThemeBundle, ThemeId } from '@workspace/contracts'

const ITEM_PREFIX = 'theme-bundle:'

export function themeBundleItemValue(id: ThemeId) {
  return `${ITEM_PREFIX}${id}`
}

export function themeBundleFromItemValue(catalog: readonly ThemeBundle[], value: string) {
  if (!value.startsWith(ITEM_PREFIX)) return null

  const id = value.slice(ITEM_PREFIX.length)
  return catalog.find((bundle) => bundle.id === id) ?? null
}
