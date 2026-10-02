import { expect, test } from 'vitest'
import {
  configuredAccounts,
  createUsageSnapshot,
  normalizeProxySnapshot,
  observeClaudeHeaders,
  restoreUsageSnapshot,
  restoreResetOrderSnapshot,
} from './usage-feed'

const seen = '2026-10-02T18:00:00.000Z'
const checked = '2026-10-02T18:10:00.000Z'
const later = '2026-10-02T18:11:00.000Z'
const weeklySignals = {
  'X-Codex-Primary-Window-Minutes': '10080',
  'X-Codex-Primary-Used-Percent': '35',
  'X-Codex-Primary-Reset-After-Seconds': '3600',
  'X-Codex-Secondary-Window-Minutes': '300',
  'X-Codex-Secondary-Used-Percent': '80',
  'X-Codex-Secondary-Reset-At': '1790967600',
}
function proxyBody(signals: Record<string, string> = weeklySignals) {
  return {
    observed_at: checked,
    files: [
      {
        provider: 'codex',
        email: 'shaul9191@example.invalid',
        label: 'unapproved label',
        name: 'private-auth.json',
        path: '/private/credentials',
        token: 'private-token',
        status: 'active',
        disabled: false,
        unavailable: false,
        quota: { observed_at: seen, signals },
        recent_requests: [{ count: 10 }],
        cooldowns: [],
      },
    ],
  }
}

test('explicit live credit absence stays absent through later quota omissions and stale policy repeats', () => {
  const first = '2026-10-02T08:00:00.000Z'
  const absentAt = '2026-10-02T09:00:00.000Z'
  const policy = {
    observedAt: first,
    observations: { 'synthetic-index': { credits: { balance: 12.5, unlimited: false } } },
  }
  const body = {
    observed_at: checked,
    files: [{ provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index' }],
  }
  const positive = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
    policy,
  )!
  expect(positive.accounts[1]!.credits).toEqual({ balance: 12.5, unlimited: false })
  const absent = normalizeProxySnapshot(
    {
      ...body,
      files: [
        {
          ...body.files[0]!,
          quota: {
            observed_at: absentAt,
            signals: {
              'X-Codex-Credits-Balance': '0',
              'X-Codex-Credits-Has-Credits': 'false',
              'X-Codex-Credits-Unlimited': 'false',
            },
          },
        },
      ],
    },
    positive,
    checked,
    policy,
  )!
  expect(absent.accounts[1]!.credits).toBeUndefined()
  const omitted = normalizeProxySnapshot(body, absent, checked, policy)!
  expect(omitted.accounts[1]!.credits).toBeUndefined()
  expect(normalizeProxySnapshot(body, omitted, later, policy)!.accounts[1]!.credits).toBeUndefined()
})

test.each([false, true])(
  'credits-only policy absence supersedes older balances independently of stored Weekly age (cached aggregate: %s)',
  (aggregate) => {
    const weeklyAt = '2026-10-02T08:00:00.000Z'
    const positiveAt = '2026-10-02T09:00:00.000Z'
    const absentAt = '2026-10-02T10:00:00.000Z'
    const file = proxyBody({
      'X-Codex-Credits-Balance': '12.5',
      'X-Codex-Credits-Has-Credits': 'true',
      'X-Codex-Credits-Unlimited': 'false',
    }).files[0]!
    file.quota.observed_at = positiveAt
    const previous = normalizeProxySnapshot(
      { observed_at: checked, files: [file] },
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    expect(previous.accounts[1]!.credits).toEqual({ balance: 12.5, unlimited: false })
    const policy = {
      observedAt: absentAt,
      observations: {
        'synthetic-index': {
          resetAt: 1791314592,
          usedPercent: 100,
          observedAt: weeklyAt,
          credits: null,
        },
      },
    }
    const identity = { provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index' }
    const body = {
      observed_at: checked,
      files: [{ ...identity, ...(aggregate ? { quota: file.quota } : {}) }],
    }
    const next = normalizeProxySnapshot(body, previous, checked, policy)!
    expect(next.accounts[1]!.credits).toBeUndefined()
    const omission = { observed_at: later, files: [identity] }
    expect(
      normalizeProxySnapshot(omission, next, later, policy)!.accounts[1]!.credits,
    ).toBeUndefined()
    file.quota.observed_at = '2026-10-02T11:00:00.000Z'
    const fresh = normalizeProxySnapshot(
      { observed_at: later, files: [{ ...identity, quota: file.quota }] },
      next,
      later,
      policy,
    )!
    expect(fresh.accounts[1]!.credits).toEqual({ balance: 12.5, unlimited: false })
  },
)

test.each([false, true])(
  'aggregate credits older than a model window omit ambiguous balances (new model observation: %s)',
  (newModel) => {
    const initialAt = '2026-10-02T08:00:00.000Z'
    const aggregateAt = '2026-10-02T09:00:00.000Z'
    const modelAt = '2026-10-02T10:00:00.000Z'
    const credits = {
      'X-Codex-Credits-Balance': '12.5',
      'X-Codex-Credits-Has-Credits': 'true',
      'X-Codex-Credits-Unlimited': 'false',
    }
    const file = proxyBody(credits).files[0]!
    file.quota.observed_at = initialAt
    let previous = normalizeProxySnapshot(
      { observed_at: checked, files: [file] },
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    const modelQuotas = { 'gpt-6.1-sol': { observed_at: modelAt, signals: weeklySignals } }
    if (!newModel) {
      previous = normalizeProxySnapshot(
        {
          observed_at: checked,
          files: [{ provider: 'codex', label: 'shaul9191', model_quotas: modelQuotas }],
        },
        previous,
        checked,
      )!
      expect(previous.accounts[1]!.credits).toEqual({ balance: 12.5, unlimited: false })
    }
    const quota = {
      observed_at: aggregateAt,
      signals: { ...credits, 'X-Codex-Credits-Balance': '3.5' },
    }
    const body = { observed_at: checked, files: [{ ...file, quota, model_quotas: modelQuotas }] }
    const next = normalizeProxySnapshot(body, previous, checked)!
    expect(next.accounts[1]!.credits).toBeUndefined()
    expect(next.accounts[1]!.lastSeenAt).toBe(modelAt)
    expect(normalizeProxySnapshot(body, next, later)!.accounts[1]!.credits).toBeUndefined()
    quota.observed_at = '2026-10-02T11:00:00.000Z'
    expect(normalizeProxySnapshot(body, next, later)!.accounts[1]!.credits).toEqual({
      balance: 3.5,
      unlimited: false,
    })
  },
)

test('stable policy agreement and omitted credit evidence preserve uncontradicted balances without freshening them', () => {
  const policy = {
    observedAt: seen,
    observations: { 'synthetic-index': { credits: { balance: 12.5, unlimited: false } } },
  }
  const body = {
    observed_at: checked,
    files: [{ provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index' }],
  }
  const initial = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
    policy,
  )!
  const repeated = normalizeProxySnapshot(body, initial, checked, { ...policy, observedAt: later })!
  expect(repeated.accounts[1]!.credits).toEqual({ balance: 12.5, unlimited: false })
  expect(repeated.accounts[1]!.lastSeenAt).toBe(seen)
  const omitted = normalizeProxySnapshot(body, repeated, later)!
  expect(omitted.accounts[1]!.credits).toEqual({ balance: 12.5, unlimited: false })
  expect(omitted.accounts[1]!.lastSeenAt).toBe(seen)
})

test.each(['2026-10-02T08:00:00.000Z', '2026-10-02T10:00:00.000Z'])(
  'changed policy balances stay unknown regardless of stored Weekly age (%s)',
  (weeklyAt) => {
    const file = proxyBody({
      'X-Codex-Credits-Balance': '12.5',
      'X-Codex-Credits-Has-Credits': 'true',
      'X-Codex-Credits-Unlimited': 'false',
    }).files[0]!
    file.quota.observed_at = '2026-10-02T09:00:00.000Z'
    const previous = normalizeProxySnapshot(
      { observed_at: checked, files: [file] },
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    const policy = {
      observedAt: checked,
      observations: {
        'synthetic-index': {
          resetAt: 1791314592,
          usedPercent: 100,
          observedAt: weeklyAt,
          credits: { balance: 3.5, unlimited: false },
        },
      },
    }
    const body = {
      observed_at: checked,
      files: [{ provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index' }],
    }
    const next = normalizeProxySnapshot(body, previous, checked, policy)!
    expect(next.accounts[1]!.credits).toBeUndefined()
    expect(normalizeProxySnapshot(body, next, later, policy)!.accounts[1]!.credits).toBeUndefined()
  },
)

test('initial policy balance stays unknown when current model quota mixes observation ages', () => {
  const policy = {
    observedAt: checked,
    observations: {
      'synthetic-index': {
        resetAt: 1791314592,
        usedPercent: 100,
        observedAt: seen,
        credits: { balance: 12.5, unlimited: false },
      },
    },
  }
  const body = {
    observed_at: later,
    files: [
      {
        provider: 'codex',
        label: 'shaul9191',
        auth_index: 'synthetic-index',
        model_quotas: { 'gpt-6.1-sol': { observed_at: later, signals: weeklySignals } },
      },
    ],
  }
  const next = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    later,
    policy,
  )!
  expect(next.accounts[1]!.credits).toBeUndefined()
  expect(next.accounts[1]!.lastSeenAt).toBe(later)
})

test('null policy modification times never freshen retained Weekly or account observation ages', () => {
  let previous = normalizeProxySnapshot(
    proxyBody({
      ...weeklySignals,
      'X-Codex-Credits-Balance': '12.5',
      'X-Codex-Credits-Has-Credits': 'true',
      'X-Codex-Credits-Unlimited': 'false',
    }),
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  const body = {
    observed_at: later,
    files: [
      { provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index', disabled: true },
    ],
  }
  for (const modifiedAt of [checked, later, '2026-10-03T18:00:00.000Z']) {
    const policy = {
      observedAt: modifiedAt,
      observations: {
        'synthetic-index': {
          resetAt: 1790967600,
          usedPercent: 35,
          observedAt: seen,
          credits: null,
        },
      },
    }
    previous = normalizeProxySnapshot(body, previous, later, policy)!
    expect(previous.accounts[1]!.credits).toBeUndefined()
    expect(previous.accounts[1]!.windows.find(({ id }) => id === 'weekly')!.lastSeenAt).toBe(seen)
    expect(previous.accounts[1]!.lastSeenAt).toBe(seen)
  }
})

test('initial null policy stays undated and prevents later ambiguous policy balance initialization', () => {
  const body = {
    observed_at: checked,
    files: [{ provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index' }],
  }
  const absent = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
    { observedAt: checked, observations: { 'synthetic-index': { credits: null } } },
  )!
  expect(absent.accounts[1]!.credits).toBeUndefined()
  expect(absent.accounts[1]!.lastSeenAt).toBeNull()
  const repeated = normalizeProxySnapshot(body, absent, later, {
    observedAt: later,
    observations: { 'synthetic-index': { credits: null } },
  })!
  expect(repeated.accounts[1]!.lastSeenAt).toBeNull()
  const policy = {
    observedAt: seen,
    observations: { 'synthetic-index': { credits: { balance: 12.5, unlimited: false } } },
  }
  expect(
    normalizeProxySnapshot(body, repeated, later, policy)!.accounts[1]!.credits,
  ).toBeUndefined()
})

test('known Claude Max and both Codex Pro accounts exist before traffic', () => {
  const snapshot = createUsageSnapshot(configuredAccounts, checked)
  expect(snapshot.accounts.map(({ provider, label, plan }) => [provider, label, plan])).toEqual([
    ['claude', 'shaul9191', 'max'],
    ['codex', 'shaul9191', 'pro'],
    ['codex', 'shaul.lavochkin', 'pro'],
  ])
  for (const account of snapshot.accounts) {
    expect(account).toMatchObject({
      checkedAt: null,
      lastSeenAt: null,
      state: 'no-data',
      windows: [],
      cooldown: null,
      routing: { active: null, lastServedAt: null },
    })
  }
})

test.each(['primary', 'secondary'])(
  'duration identifies Weekly in %s; reset uses observation time',
  (weeklyPosition) => {
    const shortPosition = weeklyPosition === 'primary' ? 'secondary' : 'primary'
    const body = proxyBody({
      [`X-Codex-${weeklyPosition}-Window-Minutes`]: '10080',
      [`X-Codex-${weeklyPosition}-Used-Percent`]: '35',
      [`X-Codex-${weeklyPosition}-Reset-After-Seconds`]: '3600',
      [`X-Codex-${shortPosition}-Window-Minutes`]: '300',
      [`X-Codex-${shortPosition}-Used-Percent`]: '80',
      [`X-Codex-${shortPosition}-Reset-At`]: '1790967600',
    })
    const snapshot = normalizeProxySnapshot(
      body,
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    const account = snapshot.accounts[1]!
    expect(account).toMatchObject({
      plan: 'pro',
      checkedAt: checked,
      lastSeenAt: seen,
      state: 'ready',
      routing: { mode: 'rotating', active: true, lastServedAt: null },
    })
    expect(account.windows.map(({ id }) => id)).toEqual(['five_hour', 'weekly'])
    expect(account.windows.find(({ id }) => id === 'weekly')).toMatchObject({
      label: 'Weekly',
      usedPercent: 35,
      windowMinutes: 10080,
      resetsAt: '2026-10-02T19:00:00.000Z',
      lastSeenAt: seen,
    })
    expect(account.windows.find(({ id }) => id === 'five_hour')).toMatchObject({
      label: '5h',
      usedPercent: 80,
      windowMinutes: 300,
      status: 'warning',
    })
    const polled = normalizeProxySnapshot(body, snapshot, later)!
    expect(polled.accounts[1]!.lastSeenAt).toBe(seen)
    expect(polled.accounts[1]!.windows).toEqual(account.windows)
    expect(JSON.stringify(snapshot)).not.toMatch(
      /example.invalid|private-|credentials|X-Codex|recent_requests/,
    )
  },
)

test('matches approved local-part labels, ignores unknown accounts and ambiguous duplicates', () => {
  const body = proxyBody()
  body.files[0]!.email = ''
  body.files[0]!.label = 'shaul.lavochkin@example.invalid'
  const snapshot = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  expect(snapshot.accounts[2]!.windows).toHaveLength(2)
  expect(snapshot.accounts[1]!.windows).toEqual([])
  body.files.push({ ...body.files[0]! })
  expect(normalizeProxySnapshot(body, snapshot, later)!.accounts[2]!.windows).toEqual(
    snapshot.accounts[2]!.windows,
  )
})

test('model quota owns its age; unfamiliar duration remains distinct and no signals cannot freshen', () => {
  const body = {
    ...proxyBody(),
    files: [
      {
        ...proxyBody().files[0]!,
        model_quotas: {
          'gpt-6.1-sol': {
            observed_at: '2026-10-02T17:00:00Z',
            signals: {
              'X-Codex-Primary-Window-Minutes': '120',
              'X-Codex-Primary-Used-Percent': '5',
              'X-Codex-Primary-Reset-After-Seconds': '1800',
            },
          },
          'secret/model': { observed_at: seen, signals: weeklySignals },
        },
      },
    ],
  }
  const snapshot = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  expect(
    snapshot.accounts[1]!.windows.find(({ id }) => id === 'model:gpt-6.1-sol:primary'),
  ).toMatchObject({
    label: 'model gpt-6.1-sol 120m',
    windowMinutes: 120,
    lastSeenAt: '2026-10-02T17:00:00.000Z',
    resetsAt: '2026-10-02T17:30:00.000Z',
  })
  expect(JSON.stringify(snapshot)).not.toContain('secret/model')
  const empty = proxyBody({})
  empty.files[0]!.quota.observed_at = later
  const next = normalizeProxySnapshot(empty, snapshot, later)!
  expect(next.accounts[1]!.windows).toEqual(snapshot.accounts[1]!.windows)
  expect(next.accounts[1]!.lastSeenAt).toBe(seen)
})

test('invalid numeric signals stay unknown; missing duration never implies five hours', () => {
  const snapshot = normalizeProxySnapshot(
    proxyBody({
      'X-Codex-Primary-Used-Percent': 'Infinity',
      'X-Codex-Primary-Reset-At': '',
      'X-Codex-Secondary-Used-Percent': '0x64',
      'X-Codex-Secondary-Window-Minutes': '10080',
    }),
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  expect(snapshot.accounts[1]!.windows).toEqual([])
  const missingLength = normalizeProxySnapshot(
    proxyBody({ 'X-Codex-Primary-Used-Percent': '12' }),
    snapshot,
    checked,
  )!
  expect(missingLength.accounts[1]!.windows[0]).toMatchObject({
    id: 'primary',
    label: 'Quota',
    usedPercent: 12,
    windowMinutes: null,
    resetsAt: null,
  })
})

test.each([
  { minutes: undefined, resetAt: undefined },
  { minutes: undefined, resetAt: '0' },
])(
  'unknown duration/reset signals ($minutes, $resetAt) do not invent a reset at observation time',
  ({ minutes, resetAt }) => {
    const signals: Record<string, string> = {
      'X-Codex-Secondary-Used-Percent': '0',
      'X-Codex-Secondary-Reset-After-Seconds': '0',
    }
    if (minutes !== undefined) signals['X-Codex-Secondary-Window-Minutes'] = minutes
    if (resetAt !== undefined) signals['X-Codex-Secondary-Reset-At'] = resetAt
    const snapshot = normalizeProxySnapshot(
      proxyBody(signals),
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    expect(snapshot.accounts[1]!.windows).toEqual([
      {
        id: 'secondary',
        label: 'Quota',
        usedPercent: 0,
        windowMinutes: null,
        resetsAt: null,
        status: 'allowed',
        lastSeenAt: seen,
        source: 'proxy-state',
      },
    ])
  },
)

test.each([
  { minutes: '300', resetAt: undefined, seconds: '0', expected: seen },
  { minutes: '300', resetAt: '1790967600', seconds: '0', expected: '2026-10-02T19:00:00.000Z' },
  { minutes: undefined, resetAt: '1790967600', seconds: '0', expected: '2026-10-02T19:00:00.000Z' },
  { minutes: undefined, resetAt: '0', seconds: '3600', expected: '2026-10-02T19:00:00.000Z' },
  { minutes: undefined, resetAt: undefined, seconds: '3600', expected: '2026-10-02T19:00:00.000Z' },
])(
  'Codex reset evidence stays independent of duration ($minutes, $resetAt, $seconds)',
  ({ minutes, resetAt, seconds, expected }) => {
    const signals: Record<string, string> = {
      'X-Codex-Primary-Used-Percent': '0',
      'X-Codex-Primary-Reset-After-Seconds': seconds,
    }
    if (minutes !== undefined) signals['X-Codex-Primary-Window-Minutes'] = minutes
    if (resetAt !== undefined) signals['X-Codex-Primary-Reset-At'] = resetAt
    const snapshot = normalizeProxySnapshot(
      proxyBody(signals),
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    expect(snapshot.accounts[1]!.windows[0]!.resetsAt).toBe(expected)
  },
)

test.each(['primary', 'secondary'])(
  'learning %s duration replaces only fresh positional aliases in the same quota namespace',
  (position) => {
    const other = position === 'primary' ? 'secondary' : 'primary'
    const unknown = { [`X-Codex-${position}-Used-Percent`]: '12' }
    const initialBody = {
      ...proxyBody(),
      files: [
        {
          ...proxyBody().files[0]!,
          quota: {
            observed_at: checked,
            signals: {
              ...unknown,
              [`X-Codex-${other}-Window-Minutes`]: '10080',
              [`X-Codex-${other}-Used-Percent`]: '35',
              [`X-Codex-Bengalfox-${position}-Used-Percent`]: '13',
              [`X-Codex-Code-Review-${position}-Used-Percent`]: '14',
            },
          },
          model_quotas: {
            'gpt-6.1-sol': { observed_at: checked, signals: unknown },
            'gpt-6.2': { observed_at: checked, signals: unknown },
          },
        },
      ],
    }
    const initial = normalizeProxySnapshot(
      initialBody,
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    const identified = {
      [`X-Codex-${position}-Window-Minutes`]: '300',
      [`X-Codex-${position}-Used-Percent`]: '25',
      [`X-Codex-${position}-Reset-After-Seconds`]: '3600',
    }
    const incoming = {
      ...proxyBody(),
      files: [
        {
          ...proxyBody().files[0]!,
          quota: {
            observed_at: seen,
            signals: {
              ...identified,
              [`X-Codex-Additional-Gpt-5.3-Codex-Spark-${position}-Window-Minutes`]: '300',
              [`X-Codex-Additional-Gpt-5.3-Codex-Spark-${position}-Used-Percent`]: '25',
            },
          },
          model_quotas: { 'gpt-6.1-sol': { observed_at: seen, signals: identified } },
        },
      ],
    }
    expect(normalizeProxySnapshot(incoming, initial, later)!.accounts[1]!.windows).toEqual(
      initial.accounts[1]!.windows,
    )
    for (const observation of [checked, later]) {
      incoming.files[0]!.quota.observed_at = observation
      incoming.files[0]!.model_quotas['gpt-6.1-sol'].observed_at = observation
      const windows = normalizeProxySnapshot(incoming, initial, later)!.accounts[1]!.windows
      expect(windows.map(({ id }) => id)).toEqual([
        'five_hour',
        'weekly',
        'bengalfox:five_hour',
        `code-review:${position}`,
        'model:gpt-6.1-sol:five_hour',
        `model:gpt-6.2:${position}`,
      ])
      expect(windows.find(({ id }) => id === 'five_hour')).toMatchObject({
        usedPercent: 25,
        lastSeenAt: observation,
      })
      expect(windows.find(({ id }) => id === 'weekly')).toEqual(
        initial.accounts[1]!.windows.find(({ id }) => id === 'weekly'),
      )
      expect(windows.find(({ id }) => id === `code-review:${position}`)).toEqual(
        initial.accounts[1]!.windows.find(({ id }) => id === `code-review:${position}`),
      )
      expect(windows.find(({ id }) => id === `model:gpt-6.2:${position}`)).toEqual(
        initial.accounts[1]!.windows.find(({ id }) => id === `model:gpt-6.2:${position}`),
      )
    }
  },
)

test.each(
  [
    {
      known: 'X-Codex-Bengalfox',
      unknown: 'X-Codex-Additional-Gpt-5.3-Codex-Spark',
      position: 'primary',
    },
    {
      known: 'X-Codex-Additional-Gpt-5.3-Codex-Spark',
      unknown: 'X-Codex-Bengalfox',
      position: 'primary',
    },
    {
      known: 'X-Codex-Bengalfox',
      unknown: 'X-Codex-Additional-Gpt-5.3-Codex-Spark',
      position: 'secondary',
    },
    {
      known: 'X-Codex-Additional-Gpt-5.3-Codex-Spark',
      unknown: 'X-Codex-Bengalfox',
      position: 'secondary',
    },
  ].flatMap((entry) => [300, 120].map((minutes) => ({ ...entry, minutes }))),
)(
  'equivalent prefixes prefer the identified $position window ($minutes minutes) from $known within one sample',
  ({ known, unknown, position, minutes }) => {
    const file = proxyBody({
      ...weeklySignals,
      [`${known}-${position}-Window-Minutes`]: String(minutes),
      [`${known}-${position}-Used-Percent`]: '25',
      [`${unknown}-${position}-Used-Percent`]: '12',
    }).files[0]!
    const body = {
      observed_at: checked,
      files: [{ ...file, model_quotas: { 'gpt-6.1-sol': file.quota } }],
    }
    const windows = normalizeProxySnapshot(
      body,
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!.accounts[1]!.windows
    expect(windows).toHaveLength(6)
    const allowance = minutes === 300 ? 'five_hour' : position
    expect(windows.find(({ id }) => id === `bengalfox:${allowance}`)).toMatchObject({
      usedPercent: 25,
      windowMinutes: minutes,
    })
    expect(
      windows.find(({ id }) => id === `model:gpt-6.1-sol:bengalfox:${allowance}`),
    ).toMatchObject({
      usedPercent: 25,
      windowMinutes: minutes,
    })
  },
)

test('equal-age known Codex duration survives incomplete repeats; newer unknown observations remain fresh', () => {
  const initial = normalizeProxySnapshot(
    proxyBody({
      'X-Codex-Primary-Window-Minutes': '120',
      'X-Codex-Primary-Used-Percent': '25',
    }),
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  const incomplete = proxyBody({ 'X-Codex-Primary-Used-Percent': '12' })
  expect(normalizeProxySnapshot(incomplete, initial, checked)!.accounts[1]!.windows).toEqual(
    initial.accounts[1]!.windows,
  )
  incomplete.files[0]!.quota.observed_at = later
  expect(normalizeProxySnapshot(incomplete, initial, later)!.accounts[1]!.windows[0]).toMatchObject(
    {
      id: 'primary',
      label: 'Quota',
      usedPercent: 12,
      windowMinutes: null,
      lastSeenAt: later,
    },
  )
})

test('equivalent prefixes preserve distinct identified quota durations', () => {
  const file = proxyBody({
    ...weeklySignals,
    'X-Codex-Bengalfox-Primary-Window-Minutes': '300',
    'X-Codex-Bengalfox-Primary-Used-Percent': '12',
    'X-Codex-Additional-Gpt-5.3-Codex-Spark-Primary-Window-Minutes': '10080',
    'X-Codex-Additional-Gpt-5.3-Codex-Spark-Primary-Used-Percent': '25',
  }).files[0]!
  const body = {
    observed_at: checked,
    files: [{ ...file, model_quotas: { 'gpt-6.1-sol': file.quota } }],
  }
  const windows = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!.accounts[1]!.windows
  expect(windows).toHaveLength(8)
  expect(windows.find(({ id }) => id === 'bengalfox:five_hour')).toMatchObject({
    usedPercent: 12,
    windowMinutes: 300,
  })
  expect(windows.find(({ id }) => id === 'bengalfox:weekly')).toMatchObject({
    usedPercent: 25,
    windowMinutes: 10080,
  })
  expect(windows.find(({ id }) => id === 'model:gpt-6.1-sol:bengalfox:five_hour')).toMatchObject({
    usedPercent: 12,
  })
  expect(windows.find(({ id }) => id === 'model:gpt-6.1-sol:bengalfox:weekly')).toMatchObject({
    usedPercent: 25,
  })
})

test('restart rejects cached windows with an epoch reset placeholder', () => {
  const snapshot = createUsageSnapshot(configuredAccounts, checked)
  snapshot.accounts[1]!.windows = [
    {
      id: 'primary',
      label: 'Primary',
      usedPercent: null,
      resetsAt: '1970-01-01T00:00:00.000Z',
      windowMinutes: null,
      status: 'unknown',
      lastSeenAt: seen,
      source: 'proxy-state',
    },
  ]
  expect(restoreUsageSnapshot(snapshot, configuredAccounts)).toBeNull()
})

test('generic cooldown never invents percentages; model restrictions do not become account cooldown', () => {
  const body = {
    ...proxyBody({}),
    files: [
      {
        ...proxyBody({}).files[0]!,
        cooldowns: [
          {
            scope: 'credential',
            reason: 'credential_quota',
            retry_at: '2026-10-02T20:00:00Z',
            remaining_seconds: 6600,
          },
        ],
      },
    ],
  }
  const snapshot = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  expect(snapshot.accounts[1]).toMatchObject({
    state: 'cooldown',
    windows: [],
    cooldown: {
      reason: 'credential_quota',
      until: '2026-10-02T20:00:00.000Z',
      observedAt: checked,
      source: 'proxy-state',
    },
  })
  body.files[0]!.cooldowns[0]!.scope = 'model'
  expect(normalizeProxySnapshot(body, snapshot, later)!.accounts[1]!.cooldown).toBeNull()
  body.files[0]!.cooldowns[0]!.scope = 'credential'
  body.files[0]!.cooldowns[0]!.reason = 'private-error-message'
  expect(normalizeProxySnapshot(body, snapshot, later)!.accounts[1]!.cooldown?.reason).toBe(
    'unknown',
  )
  body.files[0]!.disabled = true
  expect(normalizeProxySnapshot(body, snapshot, later)!.accounts[1]).toMatchObject({
    state: 'disabled',
    routing: { active: false },
  })
})

test('Claude scales fractions once and preserves independently aged windows and model namespaces', () => {
  const initial = createUsageSnapshot(configuredAccounts, checked)
  const first = observeClaudeHeaders(
    initial,
    new Headers({
      'Anthropic-Ratelimit-Unified-5h-Utilization': '0.2',
      'Anthropic-Ratelimit-Unified-5h-Reset': '1790967600',
      'Anthropic-Ratelimit-Unified-7d-Utilization': '0.8',
      'Anthropic-Ratelimit-Unified-7d-Status': 'allowed',
      'Anthropic-Ratelimit-Unified-7d-Sonnet-Utilization': '0.4',
    }),
    seen,
  )
  expect(first.accounts[0]!.windows.find(({ id }) => id === 'five_hour')).toMatchObject({
    usedPercent: 20,
    windowMinutes: 300,
  })
  expect(first.accounts[0]!.windows.find(({ id }) => id === 'weekly')).toMatchObject({
    usedPercent: 80,
    windowMinutes: 10080,
  })
  expect(first.accounts[0]!.windows.find(({ id }) => id === 'weekly:sonnet')).toMatchObject({
    usedPercent: 40,
    lastSeenAt: seen,
  })
  const next = observeClaudeHeaders(
    first,
    new Headers({ 'Anthropic-Ratelimit-Unified-5h-Status': 'rejected' }),
    later,
  )
  expect(next.accounts[0]!.windows.find(({ id }) => id === 'five_hour')).toMatchObject({
    usedPercent: null,
    status: 'exhausted',
    lastSeenAt: later,
  })
  expect(next.accounts[0]!.windows.find(({ id }) => id === 'weekly')!.lastSeenAt).toBe(seen)
  expect(next.accounts[0]!.routing).toEqual({ mode: 'single', active: null, lastServedAt: null })
  expect(observeClaudeHeaders(next, new Headers({ 'retry-after': '60' }), checked)).toEqual(next)
  expect(
    observeClaudeHeaders(
      next,
      new Headers({ 'Anthropic-Ratelimit-Unified-5h-Utilization': '20' }),
      checked,
    ),
  ).toEqual(next)
})

test('bad cache schema retains whole snapshot and restart validation rejects secrets and wrong identities', () => {
  const initial = createUsageSnapshot(configuredAccounts, checked)
  expect(normalizeProxySnapshot({ files: [] }, initial, checked)).toBeNull()
  expect(normalizeProxySnapshot({ observed_at: 'bad', files: [] }, initial, checked)).toBeNull()
  expect(
    normalizeProxySnapshot({ observed_at: checked, files: 'bad' }, initial, checked),
  ).toBeNull()
  expect(restoreUsageSnapshot(initial, configuredAccounts)).toEqual(initial)
  expect(restoreUsageSnapshot({ ...initial, schemaVersion: 2 }, configuredAccounts)).toBeNull()
  expect(restoreUsageSnapshot({ ...initial, token: 'private' }, configuredAccounts)).toBeNull()
  expect(
    restoreUsageSnapshot(
      {
        ...initial,
        accounts: initial.accounts.map((a) => ({ ...a, label: 'private@example.invalid' })),
      },
      configuredAccounts,
    ),
  ).toBeNull()
})

test('conflicting approved identity labels cannot duplicate one credential across accounts', () => {
  const initial = createUsageSnapshot(configuredAccounts, checked)
  const body = proxyBody()
  body.files[0]!.label = 'shaul.lavochkin'
  const next = normalizeProxySnapshot(body, initial, checked)!
  expect(next.accounts[1]).toEqual(initial.accounts[1])
  expect(next.accounts[2]).toEqual(initial.accounts[2])
})

test('strict restart validation preserves null window age without using publication time', () => {
  const snapshot = normalizeProxySnapshot(
    proxyBody(),
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  snapshot.accounts[1]!.windows[0]!.lastSeenAt = null
  expect(
    restoreUsageSnapshot(snapshot, configuredAccounts)!.accounts[1]!.windows[0]!.lastSeenAt,
  ).toBeNull()
})

test('known websocket Spark allowance shares HTTP Bengalfox identity and preserves its actual age and reset', () => {
  const prefix = 'X-Codex-Additional-Gpt-5.3-Codex-Spark'
  const body = proxyBody({
    ...weeklySignals,
    [`${prefix}-Limit-Name`]: 'GPT-5.3-Codex-Spark',
    [`${prefix}-Primary-Used-Percent`]: '0',
    [`${prefix}-Primary-Window-Minutes`]: '300',
    [`${prefix}-Primary-Reset-After-Seconds`]: '18000',
    'X-Codex-Additional-Unknown-Primary-Used-Percent': '99',
    'X-Codex-Credits-Balance': '0',
  })
  const initial = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  const allowance = initial.accounts[1]!.windows.find(({ id }) => id === 'bengalfox:five_hour')
  expect(allowance).toMatchObject({
    usedPercent: 0,
    resetsAt: '2026-10-02T23:00:00.000Z',
    windowMinutes: 300,
    lastSeenAt: seen,
    source: 'proxy-state',
  })
  expect(initial.accounts[1]!.windows.find(({ id }) => id === 'five_hour')!.usedPercent).toBe(80)
  expect(initial.accounts[1]!.windows).toHaveLength(3)
  expect(initial.accounts[1]!.routing.lastServedAt).toBeNull()
  expect(JSON.stringify(initial)).not.toMatch(/Unknown|GPT-5.3|model:|Credits|Limit-Name/)

  const resetAt = Date.parse('2026-10-03T01:00:00.000Z') / 1000
  const http = proxyBody({
    'X-Codex-Bengalfox-Primary-Used-Percent': '35',
    'X-Codex-Bengalfox-Primary-Window-Minutes': '300',
    'X-Codex-Bengalfox-Primary-Reset-At': String(resetAt),
  })
  http.files[0]!.quota.observed_at = checked
  const updated = normalizeProxySnapshot(http, initial, later)!
  expect(updated.accounts[1]!.windows.filter(({ id }) => id === 'bengalfox:five_hour')).toEqual([
    { ...allowance, usedPercent: 35, resetsAt: '2026-10-03T01:00:00.000Z', lastSeenAt: checked },
  ])
  expect(updated.accounts[1]!.windows.find(({ id }) => id === 'five_hour')!.lastSeenAt).toBe(seen)
  const staleWebsocket = normalizeProxySnapshot(body, updated, later)!
  expect(staleWebsocket.accounts[1]!.windows).toEqual(updated.accounts[1]!.windows)
})

test.each(['primary', 'secondary'])(
  'explicit zero duration removes the %s positional window in each namespace',
  (position) => {
    const signals = {
      [`X-Codex-${position}-Used-Percent`]: '12',
      [`X-Codex-Bengalfox-${position}-Used-Percent`]: '13',
    }
    const file = proxyBody(signals).files[0]!
    const body = {
      observed_at: checked,
      files: [{ ...file, model_quotas: { 'gpt-6.1-sol': file.quota } }],
    }
    const initial = normalizeProxySnapshot(
      body,
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    const absent = {
      [`X-Codex-${position}-Window-Minutes`]: '0',
      [`X-Codex-${position}-Used-Percent`]: '0',
      [`X-Codex-Bengalfox-${position}-Window-Minutes`]: '0',
      [`X-Codex-Bengalfox-${position}-Used-Percent`]: '0',
    }
    body.files[0]!.quota = { observed_at: later, signals: absent }
    body.files[0]!.model_quotas['gpt-6.1-sol'] = body.files[0]!.quota
    expect(normalizeProxySnapshot(body, initial, later)!.accounts[1]!.windows).toEqual([])
    body.files[0]!.quota.observed_at = '2026-10-02T17:00:00Z'
    expect(
      normalizeProxySnapshot(body, initial, later)!.accounts[1]!.windows.filter(
        ({ id }) => !id.startsWith('model:'),
      ),
    ).toEqual(initial.accounts[1]!.windows.filter(({ id }) => !id.startsWith('model:')))
  },
)

test.each([
  {
    balance: '12.5',
    has: 'true',
    unlimited: 'false',
    expected: { balance: 12.5, unlimited: false },
  },
  { balance: '0', has: 'false', unlimited: 'false', expected: undefined },
  { balance: '0', has: '0', unlimited: 'TRUE', expected: { balance: 0, unlimited: true } },
  { balance: '1', has: '1', unlimited: '0', expected: { balance: 1, unlimited: false } },
  { balance: 'Infinity', has: 'true', unlimited: 'false', expected: undefined },
  { balance: '-1', has: 'true', unlimited: 'false', expected: undefined },
  { balance: '12', has: 'maybe', unlimited: 'false', expected: undefined },
])(
  'account credits validate scalar signals ($balance, $has, $unlimited)',
  ({ balance, has, unlimited, expected }) => {
    const snapshot = normalizeProxySnapshot(
      proxyBody({
        ...weeklySignals,
        'X-Codex-Credits-Balance': balance,
        'X-Codex-Credits-Has-Credits': has,
        'X-Codex-Credits-Unlimited': unlimited,
      }),
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    expect(snapshot.accounts[1]!.credits).toEqual(expected)
    expect(restoreUsageSnapshot(snapshot, configuredAccounts)).toEqual(snapshot)
  },
)

test('persisted policy supplies historical Weekly and credits only after approved auth-index association', () => {
  const body = {
    observed_at: checked,
    files: [
      { provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index', disabled: true },
    ],
  }
  const policy = {
    observedAt: checked,
    observations: {
      'synthetic-index': {
        resetAt: 1791314592,
        usedPercent: 100,
        observedAt: seen,
        credits: { balance: 12.5, unlimited: false },
        disabledByLoop: true,
      },
    },
  }
  const snapshot = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    later,
    policy,
  )!
  expect(snapshot.accounts[1]).toMatchObject({
    state: 'disabled',
    lastSeenAt: seen,
    credits: { balance: 12.5, unlimited: false },
    windows: [
      {
        id: 'weekly',
        label: 'Weekly',
        windowMinutes: 10080,
        resetsAt: '2026-10-06T19:23:12.000Z',
        usedPercent: 100,
        status: 'exhausted',
        source: 'reset-order',
        lastSeenAt: seen,
      },
    ],
  })
  expect(JSON.stringify(snapshot)).not.toMatch(/synthetic-index|auth_index|disabledByLoop/)
  body.files[0]!.label = 'unapproved'
  expect(
    normalizeProxySnapshot(body, createUsageSnapshot(configuredAccounts, checked), later, policy)!
      .accounts[1]!.windows,
  ).toEqual([])
})

test('live quota overrides persisted policy and explicit zero credits clear retained balance', () => {
  const policy = {
    observedAt: checked,
    observations: {
      'synthetic-index': {
        resetAt: 1791314592,
        usedPercent: 100,
        observedAt: seen,
        credits: { balance: 12.5, unlimited: false },
      },
    },
  }
  const noQuota = {
    observed_at: checked,
    files: [
      { provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index', disabled: true },
    ],
  }
  const previous = normalizeProxySnapshot(
    noQuota,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
    policy,
  )!
  const file = proxyBody({
    ...weeklySignals,
    'X-Codex-Credits-Balance': '0',
    'X-Codex-Credits-Has-Credits': 'false',
    'X-Codex-Credits-Unlimited': 'false',
  }).files[0]!
  const body = {
    observed_at: later,
    files: [
      { ...file, auth_index: 'synthetic-index', quota: { ...file.quota, observed_at: later } },
    ],
  }
  const next = normalizeProxySnapshot(body, previous, later, policy)!
  expect(next.accounts[1]!.credits).toBeUndefined()
  expect(next.accounts[1]!.windows.find(({ id }) => id === 'weekly')).toMatchObject({
    source: 'proxy-state',
    usedPercent: 35,
    lastSeenAt: later,
  })
})

test.each([null, { balance: 0, unlimited: false }])(
  'persisted no-credit observation %j clears seeded credits while disabled quota is omitted',
  (credits) => {
    const previous = createUsageSnapshot(configuredAccounts, checked)
    previous.accounts[1]!.credits = { balance: 12.5, unlimited: false }
    previous.accounts[1]!.lastSeenAt = seen
    const policy = restoreResetOrderSnapshot(
      { 'synthetic-index': { resetAt: 1791314592, usedPercent: 100, observedAt: seen, credits } },
      later,
    )
    expect(policy).not.toBeNull()
    const body = {
      observed_at: later,
      files: [
        { provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index', disabled: true },
      ],
    }
    const next = normalizeProxySnapshot(body, previous, later, policy!)!
    expect(next.accounts[1]!.credits).toBeUndefined()
    expect(next.accounts[1]!.windows).toMatchObject([
      { id: 'weekly', usedPercent: 100, lastSeenAt: seen },
    ])
  },
)

test('credits-only explicit absence survives policy restoration without inventing quota', () => {
  const policy = restoreResetOrderSnapshot({ 'synthetic-index': { credits: null } }, later)
  expect(policy).not.toBeNull()
  const previous = createUsageSnapshot(configuredAccounts, checked)
  previous.accounts[1]!.credits = { balance: 12.5, unlimited: false }
  const body = {
    observed_at: later,
    files: [{ provider: 'codex', label: 'shaul9191', auth_index: 'synthetic-index' }],
  }
  const next = normalizeProxySnapshot(body, previous, later, policy!)!
  expect(next.accounts[1]!.credits).toBeUndefined()
  expect(next.accounts[1]!.windows).toEqual([])
})

test('complete current slot durations retire older canonical windows that are now absent', () => {
  const file = proxyBody(weeklySignals).files[0]!
  const initialBody = {
    observed_at: checked,
    files: [{ ...file, model_quotas: { 'gpt-6.1-sol': file.quota } }],
  }
  const previous = normalizeProxySnapshot(
    initialBody,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  const signals = {
    'X-Codex-Primary-Window-Minutes': '10080',
    'X-Codex-Primary-Used-Percent': '35',
    'X-Codex-Secondary-Window-Minutes': '0',
    'X-Codex-Secondary-Used-Percent': '0',
  }
  const quota = { observed_at: later, signals }
  const body = {
    observed_at: later,
    files: [{ ...file, quota, model_quotas: { 'gpt-6.1-sol': quota } }],
  }
  expect(
    normalizeProxySnapshot(body, previous, later)!.accounts[1]!.windows.map(({ id }) => id),
  ).toEqual(['weekly', 'model:gpt-6.1-sol:weekly'])
  quota.observed_at = '2026-10-02T17:00:00Z'
  expect(normalizeProxySnapshot(body, previous, later)!.accounts[1]!.windows).toEqual(
    previous.accounts[1]!.windows,
  )
})

test('an explicit slot absence withdraws an older identified reading without guessing its slot', () => {
  const body = proxyBody({
    'X-Codex-Primary-Window-Minutes': '300',
    'X-Codex-Primary-Used-Percent': '35',
  })
  const previous = normalizeProxySnapshot(
    body,
    createUsageSnapshot(configuredAccounts, checked),
    checked,
  )!
  body.files[0]!.quota = {
    observed_at: later,
    signals: { 'X-Codex-Primary-Window-Minutes': '0', 'X-Codex-Primary-Used-Percent': '0' },
  }
  expect(normalizeProxySnapshot(body, previous, later)!.accounts[1]!.windows).toEqual([])
})

test.each([false, true])(
  'equivalent prefixes retain distinct identified unfamiliar durations, reversed=%s',
  (reverse) => {
    const signals = {
      'X-Codex-Bengalfox-Primary-Window-Minutes': reverse ? '300' : '120',
      'X-Codex-Bengalfox-Primary-Used-Percent': '35',
      'X-Codex-Additional-gpt-5.3-codex-spark-Primary-Window-Minutes': reverse ? '120' : '300',
      'X-Codex-Additional-gpt-5.3-codex-spark-Primary-Used-Percent': '45',
    }
    const file = proxyBody(signals).files[0]!
    const body = {
      observed_at: checked,
      files: [{ ...file, model_quotas: { 'gpt-6.1-sol': file.quota } }],
    }
    const next = normalizeProxySnapshot(
      body,
      createUsageSnapshot(configuredAccounts, checked),
      checked,
    )!
    expect(next.accounts[1]!.windows.map(({ windowMinutes }) => windowMinutes).sort()).toEqual([
      120, 120, 300, 300,
    ])
  },
)

test.each(['five-hour', 'spark'])(
  'restore omitted policy Weekly alongside a live %s allowance',
  (kind) => {
    const signals: Record<string, string> =
      kind === 'spark'
        ? {
            'X-Codex-Bengalfox-Primary-Window-Minutes': '300',
            'X-Codex-Bengalfox-Primary-Used-Percent': '35',
          }
        : { 'X-Codex-Primary-Window-Minutes': '300', 'X-Codex-Primary-Used-Percent': '35' }
    const file = { ...proxyBody(signals).files[0]!, auth_index: 'synthetic-approved' }
    const policy = restoreResetOrderSnapshot(
      { 'synthetic-approved': { resetAt: 1790967600, usedPercent: 90, observedAt: seen } },
      checked,
    )!
    const next = normalizeProxySnapshot(
      { observed_at: checked, files: [file] },
      createUsageSnapshot(configuredAccounts, checked),
      checked,
      policy,
    )!
    expect(next.accounts[1]!.windows.find(({ id }) => id === 'weekly')).toMatchObject({
      source: 'reset-order',
      usedPercent: 90,
      lastSeenAt: seen,
    })
  },
)
