export function settingsCategorySlug(category: string) {
  return category
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function settingsCategoryForSlug(slug: string, categories: readonly string[]) {
  const wanted = settingsCategorySlug(slug)

  return categories.find((category) => settingsCategorySlug(category) === wanted) ?? null
}
