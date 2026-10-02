import { readSettings } from '../../../desktop/src/launcher/settings'
import { test, expect } from '../fixtures'

for (const webBase of ['/', '/platform/']) {
  test(`launcher reads window settings with webBase ${webBase}`, async ({ server, client }) => {
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
    const settings = await readSettings(server.origin, `${server.origin}${webBase}`, {
      signal: new AbortController().signal,
      fetcher: async (input, init) => {
        const response = await server.app.handle(new Request(input, init))
        status = response.status
        return response
      },
      onUnreachable: () => {},
    })
    expect(status).toBe(200)
    expect(settings.browser).toBe('webview')
    expect(settings.transparency).toBe('window')
  })
}
