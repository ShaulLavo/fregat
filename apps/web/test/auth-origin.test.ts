import { test, expect } from './fixtures'

test.for(['same-origin', 'same-site'])(
  'accepts a $0 browser GET with a trusted referrer and no Origin',
  async (site, { server }) => {
    const response = await server.app.handle(
      new Request('http://local/health', {
        headers: {
          referer: `${server.origin}/platform/`,
          'sec-fetch-site': site,
        },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  },
)

test.for([
  { origin: 'https://untrusted.example', site: 'same-origin', status: 403 },
  { origin: 'null', site: 'same-origin', status: 403 },
  { origin: 'https://untrusted.example', site: 'same-site', status: 403 },
  { origin: 'null', site: 'same-site', status: 403 },
])('does not override Origin $origin with a trusted referrer', async (example, { server }) => {
  const response = await server.app.handle(
    new Request('http://local/health', {
      headers: {
        origin: example.origin,
        referer: `${server.origin}/platform/`,
        'sec-fetch-site': example.site,
      },
    }),
  )

  expect(response.status).toBe(example.status)
})

test.for([
  { referer: 'https://untrusted.example/platform/', site: 'same-origin', status: 403 },
  { referer: 'http://localhost:9999/platform/', site: 'same-origin', status: 403 },
  { referer: 'not a URL', site: 'same-origin', status: 401 },
  { referer: '', site: 'same-origin', status: 401 },
  { referer: 'http://localhost:5173/platform/', site: 'cross-site', status: 401 },
  { referer: 'https://untrusted.example/platform/', site: 'same-site', status: 401 },
  { referer: 'http://localhost:9999/platform/', site: 'same-site', status: 401 },
  { referer: 'http://localhost:5173.untrusted.example/platform/', site: 'same-site', status: 401 },
  { referer: 'not a URL', site: 'same-site', status: 401 },
  { referer: '', site: 'same-site', status: 401 },
  { referer: 'http://localhost:5173/platform/', site: '', status: 401 },
])('rejects an untrusted browser request $referer $site', async (example, { server }) => {
  const response = await server.app.handle(
    new Request('http://local/health', {
      headers: { referer: example.referer, 'sec-fetch-site': example.site },
    }),
  )

  expect(response.status).toBe(example.status)
})

test('rejects a same-site navigation without a referrer', async ({ server }) => {
  const response = await server.app.handle(
    new Request('http://local/health', { headers: { 'sec-fetch-site': 'same-site' } }),
  )

  expect(response.status).toBe(401)
})
