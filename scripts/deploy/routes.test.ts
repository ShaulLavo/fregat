import { expect, test } from 'vitest'
import { parseMeshRoutes } from './routes'

const legacyTable = `ROUTE      HOST     KIND    TARGET  SCOPE    STATE  HEALTH   URL
/comfy     machine  proxy   8190    tailnet  -      healthy  https://example.test/comfy
/platform  machine  proxy   3301    tailnet  -      healthy  https://example.test/platform
`

const namedTable = `ROUTE      NAME           HOST     KIND    TARGET  SCOPE    STATE  HEALTH   URL
/comfy     Comfy Gallery  machine  proxy   8190    tailnet  -      healthy  https://example.test/comfy
/platform  Fregat App     machine  proxy   3301    tailnet  -      healthy  https://example.test/platform
`

const expected = [
  { route: '/comfy', host: 'machine', kind: 'proxy', target: '8190' },
  { route: '/platform', host: 'machine', kind: 'proxy', target: '3301' },
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
    { route: '/platform-copy', host: 'other', kind: 'static', target: '33010' },
    { route: '/platform', host: 'machine', kind: 'proxy', target: '3301→13301' },
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
