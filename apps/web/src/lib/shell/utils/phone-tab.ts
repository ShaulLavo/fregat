export type PhoneTab = { readonly rootPath: string | null; readonly token: string }

/**
 * The address tabs once the phone shows `token`, as a preview tab works: the phone's own tab gives
 * way to the next file, in its place. `own` is null when the phone owns no tab it may close.
 */
export function tabsForPhoneOpen(
  tabs: readonly string[],
  token: string,
  own: string | null,
): { readonly tabs: readonly string[]; readonly own: string | null } {
  if (tabs.includes(token)) {
    if (own === token) return { tabs, own }
    return { tabs: own === null ? tabs : tabs.filter((entry) => entry !== own), own: null }
  }
  if (own === null || !tabs.includes(own)) return { tabs: tabs.concat([token]), own: token }
  return { tabs: tabs.map((entry) => (entry === own ? token : entry)), own: token }
}
