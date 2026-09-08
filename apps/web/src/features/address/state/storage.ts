import { addressHrefFromBrowser, browserAddressHref } from '@/features/address/utils/browser-url'
import { DEV_SEARCH_KEYS } from '@workspace/client-core/address/grammar'
import { log } from '@/lib/client-logging'

/**
 * The address is BOTH the URL serialization and the localStorage restore payload.
 *
 * That is what stops this from being write-only decoration. A projection nothing
 * depends on rots silently; a projection the author's own reload goes through breaks
 * loudly, on their machine, within one dev session. One serializer, one parser,
 * exercised every time the app starts.
 */

const ADDRESS_STORAGE_KEY = 'platform.address.v2'

export function writeAddressCache(href: string) {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(ADDRESS_STORAGE_KEY, withoutDevParams(href))
  } catch {
    // Private mode and quota failures are not worth breaking a navigation over.
  }
}

/**
 * A dev param belongs to the session someone typed it into, not to the machine. They
 * ride the live URL so the code reading them late still sees them, but persisting them
 * here would turn `?decode=diffusion` — documented as opt-in per session — into a
 * permanent setting with no UI to clear it, reinstated on every launch.
 *
 * Filtered as raw text rather than through `url.searchParams.delete`. Touching
 * `searchParams` at all re-serializes the entire query, which re-escapes the `/` and
 * `~` that `?tabs=` deliberately leaves bare — so the stored address came back in a
 * shape the parser no longer reads, and a reload restored no tabs from the URL.
 */
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

/**
 * The address as something a recipient can actually open: absolute, and without the
 * dev params.
 *
 * Same filter as the stored payload, for the same reason — a dev param belongs to the
 * session someone typed it into. `?decode=` is documented as opt-in per session, so
 * shipping it inside a shared link makes it someone else's permanent setting.
 */
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

/**
 * Called before the app renders, so the rest of boot sees exactly one shape: an
 * address in the URL. A desktop launch always arrives at `/` — the shell opens
 * `BrowserWindow` with no path — which is precisely the case this covers.
 *
 * Anything already in the URL wins: a pasted link must never be overwritten by what
 * this machine happened to be doing last.
 */
export function restoreAddressFromStorage(historyApi: History = history) {
  if (typeof location === 'undefined') return null
  if (addressHrefFromBrowser(location.pathname) !== '/') return null

  const stored = readAddressCache()
  if (!stored || stored === '/') return null

  // The dev params on a cold launch are the ones the user just typed, not the ones
  // the last session happened to carry, so the live search wins over the stored one.
  const href = mergeLiveSearch(stored, location.search)
  historyApi.replaceState(null, '', browserAddressHref(href))
  // Length, not content. An address carries the user's search query, their file paths
  // and their branch names, and this is `info` — it ships in production. The redaction
  // list in `client-logging` works by field name (`absolutePath`, `fileName`, `cwd`),
  // so logging the same content as `href` would route straight around it.
  log.info({ action: 'address.restored_from_storage', area: 'address', hrefLength: href.length })

  return href
}

/**
 * Merged as raw text, for the same reason `withoutDevParams` filters as raw text:
 * `url.searchParams.set` re-serializes the ENTIRE query, re-escaping the `/` and `~`
 * that `?tabs=` deliberately leaves bare — so the address handed to `parseAddress`
 * came back in a shape it no longer reads and the tab set silently vanished.
 *
 * A live key REPLACES the stored one and the rest of the stored query is untouched,
 * which is the same rule the old `set` loop had.
 */
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
