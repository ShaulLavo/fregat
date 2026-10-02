import { expect, test, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUsageProducer } from './usage-producer'
import { configuredAccounts, createUsageSnapshot } from './usage-feed'

const observedAt = '2026-10-02T18:00:00.000Z'
const cachedBody = {
  observed_at: observedAt,
  files: [
    {
      provider: 'codex',
      label: 'shaul9191',
      status: 'active',
      quota: {
        observed_at: observedAt,
        signals: { 'X-Codex-Primary-Used-Percent': '25', 'X-Codex-Primary-Window-Minutes': '300' },
      },
    },
  ],
}
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'usage-producer-'))
  const managementKeyFile = join(directory, 'management-key')
  await writeFile(managementKeyFile, 'test-private-key\n')
  return { directory, managementKeyFile, feedDirectory: join(directory, 'feed') }
}

test('only cached management GET is called; failures/restart retain sanitized observations atomically', async () => {
  const paths = await fixture()
  let now = Date.parse(observedAt)
  let fail = false
  const requests: string[] = []
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    expect(url).toBe('http://127.0.0.1:18317/v0/management/auth-files')
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-private-key')
    return fail
      ? new Response('private-upstream-error', { status: 500 })
      : Response.json(cachedBody)
  }
  const options = {
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    accounts: configuredAccounts,
    fetcher,
    now: () => now,
  }
  const producer = await createUsageProducer(options)
  try {
    expect(await producer.poll()).toBe(true)
    expect(await producer.poll()).toBe(false)
    await producer.flush()
    const filename = join(paths.feedDirectory, 'v1.json')
    const text = await readFile(filename, 'utf8')
    expect(text).not.toMatch(/test-private-key|X-Codex|private-upstream|auth-files|management-key/)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536)
    expect(await readdir(paths.feedDirectory)).toEqual(['v1.json'])
    const before = JSON.parse(text)
    fail = true
    now += 60000
    expect(await producer.poll()).toBe(false)
    producer.observeClaude(new Headers({ 'Anthropic-Ratelimit-Unified-5h-Utilization': '0.3' }))
    await producer.flush()
    const mixed = JSON.parse(await readFile(filename, 'utf8'))
    expect(mixed.accounts[1]).toEqual(before.accounts[1])
    expect(mixed.accounts[0].windows[0].usedPercent).toBe(30)
    await producer.stop()
    const restarted = await createUsageProducer(options)
    try {
      expect(JSON.parse(await readFile(filename, 'utf8')).accounts).toEqual(mixed.accounts)
      expect(await restarted.poll()).toBe(false)
      expect(requests).toHaveLength(3)
    } finally {
      await restarted.stop()
    }
  } finally {
    await producer.stop()
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('serialized sampler cancels shutdown and does not issue overlapping polls or readiness requests', async () => {
  const paths = await fixture()
  let calls = 0
  let aborted = false
  const entered = Promise.withResolvers<void>()
  const producer = await createUsageProducer({
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    fetcher: async (_input, init) => {
      calls++
      entered.resolve()
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(init!.signal!.reason)
          },
          { once: true },
        )
      })
    },
  })
  try {
    const pending = producer.poll()
    await entered.promise
    const overlapping = producer.poll()
    await producer.stop()
    expect(await pending).toBe(false)
    expect(await overlapping).toBe(false)
    expect(aborted).toBe(true)
    expect(calls).toBe(1)
    expect(await producer.poll()).toBe(false)
  } finally {
    await producer.stop()
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('bounds cached response body size, malformed JSON and redirects; retains prior file', async () => {
  const paths = await fixture()
  let now = Date.parse(observedAt)
  const responses = [
    Response.json(cachedBody),
    new Response('x'.repeat(65537)),
    new Response('{'),
    new Response(null, {
      status: 302,
      headers: { location: 'https://api.anthropic.com/v1/messages' },
    }),
  ]
  const producer = await createUsageProducer({
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    now: () => now,
    fetcher: async () => responses.shift()!,
  })
  try {
    expect(await producer.poll()).toBe(true)
    await producer.flush()
    const first = await readFile(join(paths.feedDirectory, 'v1.json'), 'utf8')
    for (let i = 0; i < 3; i++) {
      now += 60000
      expect(await producer.poll()).toBe(false)
      await producer.flush()
      expect(await readFile(join(paths.feedDirectory, 'v1.json'), 'utf8')).toBe(first)
    }
  } finally {
    await producer.stop()
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('deadline includes streaming body reads and cancels a hung reader', async () => {
  const paths = await fixture()
  let canceled = false
  const producer = await createUsageProducer({
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    requestTimeoutMs: 20,
    fetcher: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{'))
          },
          cancel() {
            canceled = true
          },
        }),
      ),
  })
  try {
    expect(await producer.poll()).toBe(false)
    expect(canceled).toBe(true)
  } finally {
    await producer.stop()
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('timer samples only within running lifecycle and no faster than sixty seconds', async () => {
  const paths = await fixture()
  const fetcher = vi.fn(async () => Response.json(cachedBody))
  const producer = await createUsageProducer({
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    fetcher,
  })
  vi.useFakeTimers()
  try {
    producer.start()
    await vi.advanceTimersByTimeAsync(0)
    await expect.poll(() => fetcher.mock.calls.length).toBe(1)
    await producer.poll()
    await producer.flush()
    await vi.advanceTimersByTimeAsync(59999)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect.poll(() => fetcher.mock.calls.length).toBe(2)
    await producer.stop()
    await vi.advanceTimersByTimeAsync(120000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  } finally {
    vi.useRealTimers()
    await producer.stop()
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('malformed or oversized persisted feed starts configured no-data without publishing arbitrary fields', async () => {
  const paths = await fixture()
  const { mkdir } = await import('node:fs/promises')
  await mkdir(paths.feedDirectory)
  const filename = join(paths.feedDirectory, 'v1.json')
  for (const text of [
    'x'.repeat(65537),
    JSON.stringify({ ...createUsageSnapshot(configuredAccounts, observedAt), secret: 'private' }),
  ]) {
    await writeFile(filename, text)
    const producer = await createUsageProducer({
      ...paths,
      proxyUrl: 'http://127.0.0.1:18317',
      fetcher: async () => Response.json(cachedBody),
    })
    try {
      const snapshot = JSON.parse(await readFile(filename, 'utf8'))
      expect(snapshot.accounts.every((a: { state: string }) => a.state === 'no-data')).toBe(true)
      expect(JSON.stringify(snapshot)).not.toContain('private')
    } finally {
      await producer.stop()
    }
  }
  await rm(paths.directory, { recursive: true, force: true })
})

test('dedicated publication directory rejects credential files, symlinks and nonloopback management', async () => {
  const paths = await fixture()
  const { mkdir, symlink } = await import('node:fs/promises')
  const options = {
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    fetcher: vi.fn(async () => Response.json(cachedBody)),
  }
  try {
    await mkdir(paths.feedDirectory)
    const credential = join(paths.feedDirectory, 'credentials.json')
    await writeFile(credential, 'private')
    await expect(createUsageProducer(options)).rejects.toMatchObject({
      code: 'usage-feed.UNSAFE_LOCATION',
    })
    await rm(credential)
    await symlink(paths.managementKeyFile, join(paths.feedDirectory, 'v1.json'))
    await expect(createUsageProducer(options)).rejects.toMatchObject({
      code: 'usage-feed.UNSAFE_LOCATION',
    })
    await rm(join(paths.feedDirectory, 'v1.json'))
    await expect(
      createUsageProducer({ ...options, proxyUrl: 'https://api.anthropic.com' }),
    ).rejects.toMatchObject({ code: 'usage-feed.UNSAFE_LOCATION' })
    expect(options.fetcher).not.toHaveBeenCalled()
  } finally {
    await rm(paths.directory, { recursive: true, force: true })
  }
})

test('many passive responses coalesce without partial JSON or lost newest observation', async () => {
  const paths = await fixture()
  let now = Date.parse(observedAt)
  const producer = await createUsageProducer({
    ...paths,
    proxyUrl: 'http://127.0.0.1:18317',
    now: () => now,
    fetcher: async () => Response.json(cachedBody),
  })
  try {
    for (let i = 0; i <= 100; i++) {
      now++
      producer.observeClaude(
        new Headers({ 'anthropic-ratelimit-unified-5h-utilization': String(i / 100) }),
      )
      const visible = JSON.parse(await readFile(join(paths.feedDirectory, 'v1.json'), 'utf8'))
      expect(visible.schemaVersion).toBe(1)
    }
    await producer.flush()
    const last = JSON.parse(await readFile(join(paths.feedDirectory, 'v1.json'), 'utf8'))
    expect(last.accounts[0].windows[0]).toMatchObject({
      usedPercent: 100,
      lastSeenAt: new Date(now).toISOString(),
    })
    expect(await readdir(paths.feedDirectory)).toEqual(['v1.json'])
  } finally {
    await producer.stop()
    await rm(paths.directory, { recursive: true, force: true })
  }
})
