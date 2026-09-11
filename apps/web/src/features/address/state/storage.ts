import { addressHrefFromBrowser } from '@/features/address/utils/browser-url'
import { DEV_SEARCH_KEYS } from '@workspace/client-core/address/grammar'

const ADDRESS_STORAGE_KEY = 'platform.address.v2'

export function writeAddressCache(href: string) {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(ADDRESS_STORAGE_KEY, withoutDevParams(href))
  } catch {
    // Storage restrictions must not prevent navigation.
  }
}

// Keep dev flags session-local and preserve raw token delimiters during filtering.
function withoutDevParams(href: string) {
  const url = new URL(href, 'http://localhost')
  const query = url.search.slice(1)
  if (!query) return `${url.pathname}${url.hash}`

  const kept = query
    .split('&')
    .filter((pair) => !DEV_SEARCH_KEYS.some((key) => pair === key || pair.startsWith(`${key}=`)))
    .join('&')

  return `${url.pathname}${kept ? `?${kept}` : ''}${url.hash}`
}

export function shareableAddress(href: string = location.href, origin = location.origin) {
  return `${origin}${withoutDevParams(href)}`
}

export function readAddressCache() {
  if (typeof localStorage === 'undefined') return null

  try {
    return localStorage.getItem(ADDRESS_STORAGE_KEY)
  } catch {
    return null
  }
}

export function selectInitialAddress(liveHref: string, stored: string | null = readAddressCache()) {
  const live = new URL(liveHref, 'http://localhost')
  const address = addressHrefFromBrowser(liveHref)
  if (addressHrefFromBrowser(live.pathname) !== '/' || !stored || stored === '/') return address
  return mergeLiveSearch(stored, live.search)
}

// URLSearchParams would re-encode the readable token grammar in untouched fields.
function mergeLiveSearch(stored: string, liveSearch: string) {
  if (!liveSearch || liveSearch === '?') return stored

  const url = new URL(stored, 'http://localhost')
  const live = liveSearch.replace(/^\?/, '')
  if (!live) return stored

  const overridden = new Set(Array.from(new URLSearchParams(live).keys()))
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((pair) => Boolean(pair) && !overridden.has(searchPairKey(pair)))
  const query = [...kept, live].join('&')

  return `${url.pathname}?${query}${url.hash}`
}

/** The key half of a raw `key=value` pair; a bare `key` with no `=` is all key. */
function searchPairKey(pair: string) {
  const equals = pair.indexOf('=')

  return equals < 0 ? pair : pair.slice(0, equals)
}
