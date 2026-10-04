import { randomUUID } from 'node:crypto'

type FixtureFetcher = (url: URL, init: RequestInit) => Promise<Response>

export async function fixtureReadiness(
  serverUrl: URL,
  webOrigin: string,
  { fetcher = fetch, signal }: { fetcher?: FixtureFetcher; signal?: AbortSignal } = {},
): Promise<Response> {
  const health = await fetcher(new URL('/health', serverUrl), {
    headers: { origin: webOrigin },
    signal,
  })
  if (!health.ok) return health

  // Terminal mutations wait for orphan recovery; a fresh key clears no existing history.
  return fetcher(new URL('/terminal/clear', serverUrl), {
    method: 'POST',
    headers: { origin: webOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ worktreeId: randomUUID(), terminalId: 'fixture-readiness' }),
    signal,
  })
}
