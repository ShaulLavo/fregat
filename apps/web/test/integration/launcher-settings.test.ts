import { readSettings } from '../../../desktop/src/launcher/settings'
import { test, expect } from '../fixtures'

for (const webBase of ['/', '/platform/']) {
  test(`launcher reads window settings with webBase ${webBase}`, async ({ server, client }) => {
    await server.restart({ system: { address: server.origin, webBase } })
    const webUrl = new URL(webBase, server.origin).href
    const rejected = await server.app.handle(
      new Request(`${server.origin}/settings`, { headers: { Origin: webUrl } }),
    )
    expect(rejected.status).toBe(403)
    const write = await client.settings.write.post({
      mutationId: `launcher-settings-${webBase}`,
      target: 'user',
      operations: [
        { kind: 'set', key: 'window.browser', value: 'webview' },
        { kind: 'set', key: 'window.transparency', value: 'window' },
      ],
    })
    expect(write.error).toBeNull()
    let status: number | undefined
    let origin: string | null = null
    const warnings: Record<string, unknown>[] = []
    const settings = await readSettings(server.origin, webUrl, {
      signal: new AbortController().signal,
      fetcher: async (input, init) => {
        const request = new Request(input, init)
        origin = request.headers.get('Origin')
        const response = await server.app.handle(request)
        status = response.status
        return response
      },
      onWarning: (context) => warnings.push(context),
    })
    expect(status).toBe(200)
    expect(origin).toBe(server.origin)
    expect(warnings).toEqual([])
    expect(settings.browser).toBe('webview')
    expect(settings.transparency).toBe('window')
  })
}

test('launcher warns with the status when the real server rejects settings', async ({ server }) => {
  const warnings: Record<string, unknown>[] = []
  const settings = await readSettings(server.origin, 'http://untrusted.test/platform/', {
    signal: new AbortController().signal,
    fetcher: async (input, init) => server.app.handle(new Request(input, init)),
    onWarning: (context) => warnings.push(context),
  })
  expect(settings.browser).toBe('auto')
  expect(settings.transparency).toBe('compositor')
  expect(warnings).toEqual([{ status: 403, reason: 'http-failure' }])
})
