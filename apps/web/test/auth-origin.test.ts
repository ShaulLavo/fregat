import { test, expect } from './fixtures'

test('accepts a same-origin browser GET with a trusted referrer and no Origin', async ({
  server,
}) => {
  const response = await server.app.handle(
    new Request('http://local/health', {
      headers: {
        referer: `${server.origin}/platform/`,
        'sec-fetch-site': 'same-origin',
      },
    }),
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ ok: true })
})

test.for([
  { origin: 'https://untrusted.example', status: 403 },
  { origin: 'null', status: 403 },
])('does not override Origin $origin with a trusted referrer', async (example, { server }) => {
  const response = await server.app.handle(
    new Request('http://local/health', {
      headers: {
        origin: example.origin,
        referer: `${server.origin}/platform/`,
        'sec-fetch-site': 'same-origin',
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
  { referer: 'http://localhost:5173/platform/', site: 'same-site', status: 401 },
  { referer: 'http://localhost:5173/platform/', site: '', status: 401 },
])('rejects an untrusted browser request $referer $site', async (example, { server }) => {
  const response = await server.app.handle(
    new Request('http://local/health', {
      headers: { referer: example.referer, 'sec-fetch-site': example.site },
    }),
  )

  expect(response.status).toBe(example.status)
})
