import { expect, test } from 'vitest'
import { readProxyUsage } from '../usage-proxy-source'

const NOW = Date.parse('2026-10-03T12:00:00.000Z')
const SEEN = '2026-10-03T11:55:00.000Z'
const URL = 'http://127.0.0.1:18317/v1'
const SECRET = 'test-management-secret'

test('reads only management GETs and sanitizes pooled account snapshots', async () => {
  const calls: string[] = []
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async (input, init) => {
      const path = new globalThis.URL(String(input)).pathname
      calls.push(path)
      expect(init?.method).toBe('GET')
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${SECRET}`)
      return Response.json({
        files: [
          {
            id: 'private-file.json',
            auth_index: 'raw-index',
            provider: 'codex',
            email: 'pool.work@example.test',
            label: 'private',
            access_token: 'sensitive-token',
            path: '/private/credentials/private-file.json',
            status_message: 'sensitive-error',
            status: 'active',
            id_token: { chatgpt_account_id: 'raw-account', plan_type: 'pro' },
            quota: {
              observed_at: SEEN,
              signals: {
                'x-codex-primary-used-percent': '31',
                'x-codex-primary-window-minutes': '300',
                'x-codex-primary-reset-after-seconds': '3600',
                'x-codex-secondary-used-percent': '90',
                'x-codex-secondary-window-minutes': '10080',
                'x-codex-credits-has-credits': 'true',
                'x-codex-credits-unlimited': 'false',
                'x-codex-credits-balance': '12.5',
              },
            },
          },
          { id: 'other.json', provider: 'codex', disabled: true },
          { id: 'claude.json', provider: 'claude', email: 'claude@example.test' },
        ],
      })
    },
  })
  expect(calls).toEqual(['/v0/management/auth-files'])
  expect(accounts).toHaveLength(2)
  expect(accounts[0]).toMatchObject({
    accountKey: expect.stringMatching(/^proxy:[a-f0-9]{64}$/),
    driverKind: 'codex',
    label: 'pool.work',
    providerInstanceIds: [],
    planType: 'Pro',
    state: 'ready',
    source: 'cli-proxy-management',
    checkedAt: SEEN,
    lastSeenAt: SEEN,
    credits: { balance: 12.5, unlimited: false },
    routing: { mode: 'rotating', active: true, lastServedAt: null },
    windows: [
      {
        id: 'primary',
        kind: 'session',
        label: '5h',
        usedPercent: 31,
        resetsAt: '2026-10-03T12:55:00.000Z',
        windowMinutes: 300,
        observedAt: SEEN,
        source: 'cliproxy-passive-cache',
        freshness: 'unknown',
      },
      { id: 'secondary', kind: 'weekly', label: 'Weekly', usedPercent: 90 },
    ],
  })
  expect(accounts[1]).toMatchObject({ state: 'disabled', windows: [], lastSeenAt: null })
  const output = JSON.stringify(accounts)
  for (const privateValue of [
    'private',
    'raw-index',
    'sensitive',
    'raw-account',
    'claude@',
    SECRET,
  ]) {
    expect(output).not.toContain(privateValue)
  }
})

test('preserves known accounts as no-data without inventing quota from routing or totals', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            provider: 'codex',
            id: 'a',
            status: 'active',
            success: 200,
            recent_requests: [{ timestamp: SEEN, success: 20 }],
            quota: {},
            id_token: { plan_type: 'email@example.test' },
          },
        ],
      }),
  })
  expect(accounts[0]).toMatchObject({
    state: 'no-data',
    planType: null,
    windows: [],
    checkedAt: null,
    lastSeenAt: null,
    credits: null,
    routing: { active: true, lastServedAt: null },
  })
})

test('keeps independent ages, expired resets, distinct quota windows and non-five-hour primary durations', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'a',
            provider: 'codex',
            quota: {
              observed_at: '2026-10-03T10:00:00Z',
              signals: {
                'X-Codex-Primary-Used-Percent': '20',
                'x-codex-primary-window-minutes': '60',
                'x-codex-primary-reset-at': String(Date.parse('2026-10-03T11:00:00Z') / 1000),
                'x-codex-secondary-used-percent': '40',
                'x-codex-secondary-window-minutes': '10080',
              },
            },
            model_quotas: {
              'gpt-5': {
                observed_at: SEEN,
                signals: { 'x-codex-bengalfox-primary-used-percent': '5' },
              },
              'private@example.test': {
                observed_at: SEEN,
                signals: { 'x-codex-primary-used-percent': '6' },
              },
            },
          },
        ],
      }),
  })
  expect(accounts[0]?.windows).toMatchObject([
    { id: 'primary', kind: 'other', label: '60m', freshness: 'reset-passed', usedPercent: 20 },
    { id: 'secondary', freshness: 'unknown', observedAt: '2026-10-03T10:00:00.000Z' },
    { id: 'bengalfox:primary', label: 'bengalfox Quota', freshness: 'unknown' },
  ])
  expect(accounts[0]?.lastSeenAt).toBe(SEEN)
  expect(JSON.stringify(accounts)).not.toContain('private@')
})

test('model caches contribute account headers once while distinct quota headers keep their own IDs', async () => {
  const quota = {
    observed_at: SEEN,
    signals: {
      'x-codex-primary-used-percent': '44',
      'x-codex-primary-window-minutes': '10080',
      'x-codex-primary-reset-at': '1791690150',
    },
  }
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'fixture',
            provider: 'codex',
            quota,
            model_quotas: {
              'gpt-6.1-sol': quota,
              'gpt-5': {
                observed_at: '2026-10-03T11:00:00Z',
                signals: {
                  'x-codex-primary-used-percent': '43',
                  'x-codex-primary-window-minutes': '10080',
                  'x-codex-primary-reset-at': '1791690151',
                  'x-codex-bengalfox-primary-used-percent': '9',
                  'x-codex-bengalfox-primary-window-minutes': '10080',
                  'x-codex-code-review-primary-used-percent': '11',
                  'x-codex-code-review-primary-window-minutes': '10080',
                },
              },
            },
          },
        ],
      }),
  })
  expect(accounts[0]!.windows).toMatchObject([
    { id: 'primary', usedPercent: 44, observedAt: SEEN },
    { id: 'bengalfox:primary', usedPercent: 9, observedAt: '2026-10-03T11:00:00.000Z' },
    { id: 'code-review:primary', usedPercent: 11, observedAt: '2026-10-03T11:00:00.000Z' },
  ])
  expect(accounts[0]!.windows).toHaveLength(3)
})

test('rejects invalid observations and percentages without guessing 0 or 100', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'a',
            provider: 'codex',
            quota: {
              observed_at: SEEN,
              signals: {
                'x-codex-primary-used-percent': 'NaN',
                'x-codex-primary-limit-reached': 'true',
                'x-codex-secondary-used-percent': '101',
              },
            },
          },
          {
            id: 'b',
            provider: 'codex',
            quota: {
              observed_at: 'invalid',
              signals: {
                'x-codex-primary-used-percent': '0',
              },
            },
          },
          {
            id: 'c',
            provider: 'codex',
            quota: {
              observed_at: '2026-10-04T12:00:00Z',
              signals: {
                'x-codex-primary-used-percent': '50',
              },
            },
          },
        ],
      }),
  })
  expect(accounts[0]).toMatchObject({
    state: 'ready',
    checkedAt: SEEN,
    windows: [{ id: 'primary', usedPercent: null, status: 'rejected', observedAt: SEEN }],
  })
  expect(
    accounts
      .slice(1)
      .every((account) => account.windows.length === 0 && account.checkedAt === null),
  ).toBe(true)
})

test('reports cooldown while leaving serving attribution unknown', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'a',
            provider: 'codex',
            auth_index: 'index-a',
            unavailable: true,
            next_retry_after: '2026-10-03T12:30:00Z',
            cooldowns: [{ scope: 'credential', retry_at: '2026-10-03T12:30:00Z', reason: 'quota' }],
          },
          { id: 'b', provider: 'codex', auth_index: 'index-b', status: 'active' },
        ],
      }),
  })
  expect(accounts[0]).toMatchObject({
    state: 'cooldown',
    windows: [],
    routing: { active: false, lastServedAt: null },
  })
  expect(accounts[1]?.routing?.lastServedAt).toBeNull()
})

test.each([
  { next_retry_after: '2026-10-03T12:30:00Z' },
  {
    cooldowns: [{ scope: 'credential', retry_at: '2026-10-03T12:30:00Z', reason: 'quota' }],
  },
])('observes live cooldown state independently of historical quota: %j', async (state) => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'a',
            provider: 'codex',
            ...state,
            quota: { observed_at: SEEN, signals: { 'x-codex-primary-used-percent': '25' } },
          },
        ],
      }),
  })
  expect(accounts[0]).toMatchObject({
    state: 'cooldown',
    stateObservedAt: new Date(NOW).toISOString(),
    checkedAt: SEEN,
    lastSeenAt: SEEN,
    windows: [{ observedAt: SEEN, usedPercent: 25 }],
    cooldown: {
      reason: 'cooldowns' in state ? 'quota' : 'unknown',
      until: '2026-10-03T12:30:00.000Z',
      observedAt: new Date(NOW).toISOString(),
      source: 'proxy-state',
    },
    routing: { active: false },
  })
})

test('observes unavailable management state at request start without restamping quotas', async () => {
  let clock = NOW
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => clock,
    fetch: async () => {
      clock += 60_000
      return Response.json({
        files: [
          {
            id: 'a',
            provider: 'codex',
            unavailable: true,
            quota: { observed_at: SEEN, signals: { 'x-codex-primary-used-percent': '25' } },
          },
        ],
      })
    },
  })
  expect(accounts[0]).toMatchObject({
    state: 'unknown',
    stateObservedAt: new Date(NOW).toISOString(),
    checkedAt: SEEN,
    lastSeenAt: SEEN,
    windows: [{ observedAt: SEEN }],
    routing: { active: false },
  })
  expect(accounts[0]?.cooldown).toBeUndefined()
})

test('repeated cache inspection leaves the observation and relative reset unchanged', async () => {
  const fetch = async () =>
    Response.json({
      files: [
        {
          provider: 'codex',
          id: 'a',
          quota: {
            observed_at: SEEN,
            signals: {
              'x-codex-primary-used-percent': '0',
              'x-codex-primary-window-minutes': '300',
              'x-codex-primary-reset-after-seconds': '3600',
            },
          },
        },
      ],
    })
  const fresh = await readProxyUsage({ url: URL, secret: SECRET, fetch, now: () => NOW })
  const later = await readProxyUsage({
    url: URL,
    secret: SECRET,
    fetch,
    now: () => NOW + 3_600_000,
  })
  expect(later[0]?.checkedAt).toBe(SEEN)
  expect(later[0]?.windows[0]?.resetsAt).toBe(fresh[0]?.windows[0]?.resetsAt)
  expect(later[0]?.windows[0]).toMatchObject({
    usedPercent: 0,
    freshness: 'reset-passed',
    observedAt: SEEN,
  })
})

test('ignores cached Claude accounts without requesting any provider or usage endpoint', async () => {
  const requests: string[] = []
  expect(
    await readProxyUsage({
      url: URL,
      secret: SECRET,
      fetch: async (input) => {
        requests.push(String(input))
        return Response.json({ files: [{ id: 'claude', provider: 'claude' }] })
      },
    }),
  ).toEqual([])
  expect(requests).toEqual(['http://127.0.0.1:18317/v0/management/auth-files'])
})

test('preserves quota-wide rejection and warning without inventing a window percentage', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'root',
            provider: 'codex',
            quota: {
              observed_at: SEEN,
              signals: {
                'x-codex-limit-reached': 'true',
                'x-codex-plan-type': 'pro',
              },
            },
          },
          {
            id: 'warning',
            provider: 'codex',
            quota: {
              observed_at: SEEN,
              signals: {
                'x-codex-primary-allowed': 'allowed_warning',
              },
            },
          },
        ],
      }),
  })
  expect(accounts[0]).toMatchObject({
    planType: 'Pro',
    windows: [
      { id: 'quota', label: 'Quota', usedPercent: null, status: 'rejected', observedAt: SEEN },
    ],
  })
  expect(accounts[1]?.windows).toMatchObject([
    { id: 'primary', usedPercent: null, status: 'warning', observedAt: SEEN },
  ])
})

test('credits cover exhausted windows only with a valid observed balance', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: ['10', 'malformed'].map((balance) => ({
          id: balance,
          provider: 'codex',
          quota: {
            observed_at: SEEN,
            signals: {
              'x-codex-primary-used-percent': '100',
              'x-codex-credits-has-credits': 'true',
              'x-codex-credits-unlimited': 'false',
              'x-codex-credits-balance': balance,
            },
          },
        })),
      }),
  })
  expect(accounts[0]?.windows[0]?.status).toBe('warning')
  expect(accounts[1]?.windows[0]?.status).toBe('rejected')
  expect(accounts[1]?.credits).toBeNull()
})

test('sanitizes explicitly observed cooldowns and preserves missing observation time', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        observed_at: SEEN,
        files: [
          {
            id: 'a',
            provider: 'codex',
            unavailable: true,
            cooldowns: [
              { scope: 'credential', reason: 'private@example.test', remaining_seconds: 600 },
            ],
          },
        ],
      }),
  })
  expect(accounts[0]?.cooldown).toEqual({
    reason: 'unknown',
    until: '2026-10-03T12:05:00.000Z',
    observedAt: SEEN,
    source: 'proxy-state',
  })
  expect(accounts[0]?.checkedAt).toBeNull()
  expect(JSON.stringify(accounts)).not.toContain('private@')
})

test('rejects impossible calendar observations and resets without losing valid percentages', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            id: 'invalid-observation',
            provider: 'codex',
            quota: {
              observed_at: '2026-02-30T12:00:00Z',
              signals: { 'x-codex-primary-used-percent': '50' },
            },
          },
          {
            id: 'invalid-reset',
            provider: 'codex',
            quota: {
              observed_at: SEEN,
              signals: {
                'x-codex-primary-used-percent': '50',
                'x-codex-primary-reset-at': '2026-11-31T12:00:00Z',
              },
            },
          },
        ],
      }),
  })
  expect(accounts[0]).toMatchObject({ windows: [], checkedAt: null, state: 'no-data' })
  expect(accounts[1]?.windows[0]).toMatchObject({ usedPercent: 50, resetsAt: null })
})

test('deduplicates Spark allowance aliases while keeping the known duration', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            provider: 'codex',
            id: 'a',
            quota: {
              observed_at: SEEN,
              signals: {
                'x-codex-bengalfox-primary-used-percent': '10',
                'x-codex-bengalfox-primary-window-minutes': '300',
                'x-codex-additional-gpt-5.3-codex-spark-primary-used-percent': '10',
              },
            },
          },
        ],
      }),
  })
  expect(accounts[0]?.windows).toMatchObject([
    { id: 'bengalfox:primary', usedPercent: 10, windowMinutes: 300 },
  ])
})

test('leaves usage attribution unknown when a runtime index names multiple accounts', async () => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          { provider: 'codex', id: 'a', auth_index: 'shared' },
          { provider: 'codex', id: 'b', auth_index: 'shared' },
        ],
      }),
  })
  expect(accounts).toHaveLength(2)
  expect(accounts.every((account) => account.routing?.lastServedAt === null)).toBe(true)
})

test('keeps account keys stable across reordering and isolates separate proxy origins', async () => {
  const fetch = async () => Response.json({ files: [{ provider: 'codex', id: 'a' }] })
  const first = await readProxyUsage({ url: URL, secret: SECRET, fetch })
  const again = await readProxyUsage({ url: URL, secret: 'another-secret', fetch })
  const other = await readProxyUsage({ url: 'http://127.0.0.1:18319', secret: SECRET, fetch })
  expect(first[0]?.accountKey).toBe(again[0]?.accountKey)
  expect(first[0]?.accountKey).not.toBe(other[0]?.accountKey)
})

test.each([
  'https://example.test',
  'http://127.0.0.1.example.test',
  'file:///tmp/cache',
  'http://user:password@localhost',
  'invalid',
])('rejects unsafe configured URL %s before fetching', async (url) => {
  let requests = 0
  await expect(
    readProxyUsage({
      url,
      secret: SECRET,
      fetch: async () => {
        requests++
        return Response.json({ files: [] })
      },
    }),
  ).rejects.toMatchObject({ code: expect.any(String) })
  expect(requests).toBe(0)
})

test('sanitizes management failures and malformed cache responses', async () => {
  for (const fetch of [
    async () => new Response('sensitive-token', { status: 401 }),
    async () => Response.json({ token: SECRET }),
    async () => new Response('malformed-sensitive-response'),
    async () => {
      throw SECRET
    },
    async () => new Response(' '.repeat(1024 * 1024 + 1)),
  ]) {
    try {
      await readProxyUsage({ url: URL, secret: SECRET, fetch })
      expect.fail('Expected the cache read to reject')
    } catch (error) {
      expect(error).toMatchObject({ code: expect.any(String) })
      expect(JSON.stringify(error)).not.toContain(SECRET)
      expect(JSON.stringify(error)).not.toContain('sensitive')
    }
  }
})

test.each([
  { email: 'pool.work@example.test', label: 'pool.work' },
  { email: 'pool+work@example.test', label: 'pool+work' },
  { email: 'bad\u0000local@example.test', label: undefined },
  { email: 'bad‮local@example.test', label: undefined },
  { email: 'no-at-sign', label: undefined },
  { email: 'double@@example.test', label: undefined },
  { email: `${'a'.repeat(65)}@example.test`, label: undefined },
])('proxy short labels use sanitized email local parts only: %j', async (scenario) => {
  const accounts = await readProxyUsage({
    url: URL,
    secret: SECRET,
    now: () => NOW,
    fetch: async () =>
      Response.json({
        files: [
          {
            provider: 'codex',
            id: 'private-auth-file.json',
            label: 'private-file-label',
            email: scenario.email,
          },
          { provider: 'codex', id: 'different-private-file.json', email: scenario.email },
        ],
      }),
  })
  expect(accounts).toHaveLength(2)
  expect(accounts.map((account) => ('label' in account ? account.label : undefined))).toEqual([
    scenario.label,
    scenario.label,
  ])
  expect(accounts[0]?.accountKey).not.toBe(accounts[1]?.accountKey)
  expect(JSON.stringify(accounts)).not.toMatch(
    /@|private-auth-file|different-private-file|private-file-label/,
  )
  expect(accounts.every((account) => account.routing?.lastServedAt === null)).toBe(true)
})

test.each(['disabled', 'no-data'] as const)(
  'uses genuine management plan metadata without quota: %s',
  async (state) => {
    const accounts = await readProxyUsage({
      url: URL,
      secret: SECRET,
      now: () => NOW,
      fetch: async () =>
        Response.json({
          files: [
            {
              id: 'private-empty.json',
              provider: 'codex',
              disabled: state === 'disabled',
              email: 'fixture.person@example.test',
              id_token: { chatgpt_account_id: 'private-account-id', plan_type: 'pro' },
            },
            { id: 'absent.json', provider: 'codex', disabled: true },
          ],
        }),
    })
    expect(accounts[0]).toMatchObject({
      state,
      windows: [],
      checkedAt: null,
      lastSeenAt: null,
      planType: 'Pro',
      label: 'fixture.person',
    })
    expect(accounts[1]).toMatchObject({ state: 'disabled', windows: [], planType: null })
    expect(JSON.stringify(accounts)).not.toContain('private-')
    expect(JSON.stringify(accounts)).not.toContain('@example.test')
  },
)
