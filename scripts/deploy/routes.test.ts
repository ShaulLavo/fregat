import { expect, test } from 'vitest'
import { matchesMeshRoute, parseMeshRoutes } from './routes'

const legacyTable = `ROUTE      HOST     KIND    TARGET  SCOPE    STATE  HEALTH   URL
/comfy     machine  proxy   8190    tailnet  -      healthy  https://example.test/comfy
/platform  machine  proxy   3301    tailnet  -      healthy  https://example.test/platform
`

const namedTable = `ROUTE      NAME           HOST     KIND    TARGET  SCOPE    STATE  HEALTH   URL
/comfy     Comfy Gallery  machine  proxy   8190    tailnet  -      healthy  https://example.test/comfy
/platform  Fregat App     machine  proxy   3301    tailnet  -      healthy  https://example.test/platform
`

const expected = [
  {
    route: '/comfy',
    host: 'machine',
    kind: 'proxy',
    target: '8190',
    url: 'https://example.test/comfy',
  },
  {
    route: '/platform',
    host: 'machine',
    kind: 'proxy',
    target: '3301',
    url: 'https://example.test/platform',
  },
]

test('reads route columns without a NAME column', () => {
  expect(parseMeshRoutes(legacyTable)).toEqual(expected)
})

test('reads route columns with names containing spaces', () => {
  expect(parseMeshRoutes(namedTable)).toEqual(expected)
})

test('preserves exact route, host, kind and target values', () => {
  const table = `ROUTE           NAME           HOST     KIND    TARGET       SCOPE
/platform-copy  Fregat App     other    static  33010        tailnet
/platform       Fregat App     machine  proxy   3301→13301   tailnet
`
  expect(parseMeshRoutes(table)).toEqual([
    { route: '/platform-copy', host: 'other', kind: 'static', target: '33010', url: '' },
    { route: '/platform', host: 'machine', kind: 'proxy', target: '3301→13301', url: '' },
  ])
})

test('ignores surrounding blank lines and preamble', () => {
  expect(parseMeshRoutes(`Mesh services\n\n${namedTable}\n`)).toEqual(expected)
})

test('requires a header with every route field', () => {
  expect(parseMeshRoutes('')).toEqual([])
  expect(parseMeshRoutes('/platform  machine  proxy  3301')).toEqual([])
  expect(parseMeshRoutes('ROUTE      HOST     KIND\n/platform  machine  proxy')).toEqual([])
})

const publishedTable = `ROUTE      NAME           HOST       KIND   TARGET  SCOPE    STATE  HEALTH   URL
/platform  Fregat         canonical  proxy  3301    tailnet  -      healthy  https://configured-alias.example/platform
`

const publishedRoute = parseMeshRoutes(publishedTable)[0]!
const installationUrl = 'https://configured-alias.example/platform/'

test('matches the published proxy URL when the host label differs from its configured alias', () => {
  expect(publishedRoute.host).toBe('canonical')
  expect(matchesMeshRoute(publishedRoute, '/platform', installationUrl, 3301)).toBe(true)
})

test('accepts the optional trailing slash used by the installation base', () => {
  expect(
    matchesMeshRoute(
      { ...publishedRoute, url: installationUrl },
      '/platform',
      installationUrl,
      3301,
    ),
  ).toBe(true)
})

test.each([
  { route: '/platform-copy' },
  { kind: 'static' },
  { target: '33010' },
  { target: '3301→13301' },
  { url: 'https://other.example/platform' },
  { url: 'http://configured-alias.example/platform' },
  { url: 'https://configured-alias.example/other' },
  { url: 'https://configured-alias.example/platform?route=other' },
  { url: 'https://configured-alias.example/platform#other' },
  { url: '' },
])('rejects a different published route capability: %j', (change) => {
  expect(
    matchesMeshRoute({ ...publishedRoute, ...change }, '/platform', installationUrl, 3301),
  ).toBe(false)
})

test('a matching host label does not authorize a different published origin', () => {
  expect(
    matchesMeshRoute(
      { ...publishedRoute, host: 'configured-alias', url: 'https://other.example/platform' },
      '/platform',
      installationUrl,
      3301,
    ),
  ).toBe(false)
})
