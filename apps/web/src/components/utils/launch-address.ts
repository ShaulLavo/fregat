export function launchAddress(target: string | undefined, base: string): string | null {
  if (!target) return null
  let url: URL
  try {
    url = new URL(target)
  } catch {
    return null
  }
  const app = new URL(base)
  if (url.origin !== app.origin || url.username || url.password) return null
  const prefix = app.pathname.replace(/\/$/u, '')
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return null
  // Opening the application itself focuses the retained client, preserving its address and work.
  if ((url.pathname === prefix || url.pathname === `${prefix}/`) && !url.search && !url.hash)
    return null
  return `${url.pathname}${url.search}${url.hash}`
}
