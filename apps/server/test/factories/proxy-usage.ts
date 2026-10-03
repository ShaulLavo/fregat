export function startProxyUsageHttpFixture(
  observedAt: string,
  accounts?: readonly Record<string, unknown>[],
) {
  const requests: Array<{ method: string; path: string }> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname
      requests.push({ method: request.method, path })
      if (request.method !== 'GET' || path !== '/v0/management/auth-files')
        return Response.json({ unexpected: true }, { status: 404 })
      return Response.json({
        files: accounts ?? [
          {
            id: 'synthetic-pooled-account',
            provider: 'codex',
            status: 'active',
            quota: {
              observed_at: observedAt,
              signals: {
                'x-codex-primary-used-percent': '25',
                'x-codex-primary-window-minutes': '300',
                'x-codex-primary-reset-after-seconds': '3600',
              },
            },
          },
        ],
      })
    },
  })
  return {
    url: server.url.toString(),
    requests,
    close: () => server.stop(true),
  }
}
