import type { Fetcher } from '../fetcher'

type Route = (url: URL) => Response | Promise<Response>

/** A fetcher over fixed routes that fails on anything else, as MSW's `onUnhandledRequest: 'error'`. */
export function routedFetcher(routes: Record<string, Route>) {
  const requests: string[] = []
  const fetcher: Fetcher = async (input) => {
    const url = new URL(String(input))
    requests.push(url.href)
    const route = routes[url.href]
    if (!route) throw new TypeError(`Unhandled request: ${url.href}`)

    return route(url)
  }
  return { fetcher, requests }
}

const FONTSOURCE_CATALOG = [
  {
    id: 'geist',
    family: 'Geist',
    subsets: ['cyrillic', 'latin'],
    weights: [100, 400, 500, 600, 700, 900],
    styles: ['italic', 'normal'],
    defSubset: 'latin',
    variable: true,
    category: 'sans-serif',
    license: 'OFL-1.1',
    type: 'google',
  },
  {
    id: 'lobster',
    family: 'Lobster',
    subsets: ['latin'],
    weights: [400],
    styles: ['normal'],
    defSubset: 'latin',
    variable: false,
    category: 'display',
    license: 'OFL-1.1',
    type: 'google',
  },
  {
    id: 'material-icons',
    family: 'Material Icons',
    subsets: ['latin'],
    weights: [400],
    styles: ['normal'],
    defSubset: 'latin',
    variable: false,
    category: 'icons',
    license: 'Apache-2.0',
    type: 'google',
  },
]

export const LATIN_RANGE = 'U+0000-00FF,U+0131'
export const CYRILLIC_RANGE = 'U+0400-045F'

export function fontsourceRoutes(): Record<string, Route> {
  const api = 'https://api.fontsource.org/v1'
  const cdn = 'https://cdn.jsdelivr.net/fontsource/fonts'
  return {
    [`${api}/fonts`]: () => Response.json(FONTSOURCE_CATALOG),
    [`${api}/fonts/geist`]: () =>
      Response.json({ unicodeRange: { latin: LATIN_RANGE, cyrillic: CYRILLIC_RANGE } }),
    [`${api}/variable/geist`]: () =>
      Response.json({ axes: { wght: { min: '100', max: '900', default: '400' } } }),
    [`${api}/fonts/lobster`]: () => Response.json({ unicodeRange: { latin: LATIN_RANGE } }),
    [`${cdn}/geist:vf@latest/latin-wght-normal.woff2`]: () => new Response('geist-latin-wght'),
    [`${cdn}/geist@latest/latin-400-normal.woff2`]: () => new Response('geist-latin-400'),
    [`${cdn}/lobster@latest/latin-400-normal.woff2`]: () => new Response('lobster-latin-400'),
  }
}
