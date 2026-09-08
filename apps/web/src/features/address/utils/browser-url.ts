export function browserAddressHref(href: string, base = import.meta.env.BASE_URL): string {
  return `${base.replace(/\/$/u, '')}${href}`
}

export function addressHrefFromBrowser(href: string, base = import.meta.env.BASE_URL): string {
  const url = new URL(href, 'http://localhost')
  const prefix = base.replace(/\/$/u, '')
  let pathname = url.pathname
  if (pathname === prefix) pathname = '/'
  if (pathname.startsWith(`${prefix}/`)) pathname = pathname.slice(prefix.length)

  return `${pathname}${url.search}${url.hash}`
}
