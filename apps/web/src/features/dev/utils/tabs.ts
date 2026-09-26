export const DEV_TABS = [
  { id: 'loaders', label: 'Loaders' },
  { id: 'physical', label: 'Physical' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'handles', label: 'Handles' },
] as const

export type DevTabId = (typeof DEV_TABS)[number]['id']

/** `<base>dev/<tab>`; anything else, including bare `/dev`, lands on the first tab. */
export function devTabForPath(pathname: string, base: string): DevTabId {
  const segment = pathname.slice(base.length).split('/')[1]
  return DEV_TABS.find((tab) => tab.id === segment)?.id ?? DEV_TABS[0].id
}

export function devTabHref(id: DevTabId, base: string) {
  return `${base}dev/${id}`
}
