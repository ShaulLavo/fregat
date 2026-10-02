import { expect, test, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeObservations,
  mergeStoredObservations,
  type StoredObservation,
  planPriorities,
  planDisabled,
  readObservation,
  startResetOrder,
  type Credential,
} from './reset-order'

const now = 1_000_000

function credential(
  index: string,
  observation: Credential['observation'],
  provider: Credential['provider'] = 'codex',
): Credential {
  return { name: `${index}.json`, provider, index, priority: 0, disabled: false, observation }
}

test('accounts with quota left rank by soonest weekly reset', () => {
  const credentials = [
    credential('late', { resetAt: now + 500, usedPercent: 10 }),
    credential('soon', { resetAt: now + 100, usedPercent: 90 }),
    credential('middle', { resetAt: now + 300, usedPercent: 0 }),
  ]
  const priorities = planPriorities(credentials, mergeObservations(credentials, {}, now))
  expect(Object.fromEntries(priorities)).toEqual({
    'soon.json': 3,
    'middle.json': 2,
    'late.json': 1,
  })
})

test('spent accounts drop below unknown ones, which keep the default priority', () => {
  const credentials = [
    credential('spent', { resetAt: now + 100, usedPercent: 100 }),
    credential('unknown', null),
    credential('usable', { resetAt: now + 900, usedPercent: 40 }),
  ]
  const priorities = planPriorities(credentials, mergeObservations(credentials, {}, now))
  expect(Object.fromEntries(priorities)).toEqual({
    'usable.json': 1,
    'unknown.json': 0,
    'spent.json': -1,
  })
})

test('an observation whose reset has passed counts as unknown', () => {
  const credentials = [
    credential('reset', { resetAt: now - 1, usedPercent: 100 }),
    credential('usable', { resetAt: now + 10, usedPercent: 5 }),
  ]
  const observations = mergeObservations(credentials, {}, now)
  expect(observations).toEqual({ usable: { resetAt: now + 10, usedPercent: 5 } })
  expect(planPriorities(credentials, observations).get('reset.json')).toBe(0)
})

test('stored observations stand in until the restarted proxy observes the account again', () => {
  const stored = {
    a: { resetAt: now + 50, usedPercent: 20 },
    b: { resetAt: now + 10, usedPercent: 100 },
    gone: { resetAt: now + 10, usedPercent: 0 },
  }
  const credentials = [
    credential('a', null),
    credential('b', { resetAt: now + 700, usedPercent: 0 }),
  ]
  const observations = mergeObservations(credentials, stored, now)
  expect(observations).toEqual({
    a: stored.a,
    b: { resetAt: now + 700, usedPercent: 0 },
  })
  expect(Object.fromEntries(planPriorities(credentials, observations))).toEqual({
    'a.json': 2,
    'b.json': 1,
  })
})

test('weekly observations carry upstream timestamps and observed credits', () => {
  const observedAt = '2026-10-03T08:00:00Z'
  expect(
    readObservation(
      'codex',
      {
        'X-Codex-Primary-Window-Minutes': '10080',
        'X-Codex-Primary-Reset-At': '12',
        'X-Codex-Primary-Used-Percent': '94',
        'X-Codex-Credits-Has-Credits': 'TRUE',
        'X-Codex-Credits-Unlimited': '0',
        'X-Codex-Credits-Balance': '62500',
      },
      observedAt,
    ),
  ).toEqual({
    resetAt: 12,
    usedPercent: 94,
    observedAt,
    credits: { balance: 62500, unlimited: false },
  })
  expect(
    readObservation(
      'claude',
      {
        'Anthropic-Ratelimit-Unified-7d-Reset': '12',
        'Anthropic-Ratelimit-Unified-7d-Utilization': '0.42',
      },
      observedAt,
    ),
  ).toEqual({ resetAt: 12, usedPercent: 42, observedAt })
})

test('weekly observations omit unobserved credit balances and timestamps', () => {
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Reset-At': '12',
      'X-Codex-Primary-Used-Percent': '94',
      'X-Codex-Credits-Has-Credits': 'true',
      'X-Codex-Credits-Unlimited': 'true',
    }),
  ).toEqual({ resetAt: 12, usedPercent: 94 })
  expect(
    readObservation(
      'codex',
      {
        'X-Codex-Credits-Has-Credits': 'true',
        'X-Codex-Credits-Unlimited': 'false',
        'X-Codex-Credits-Balance': '25',
      },
      '2026-10-03T09:00:00Z',
    ),
  ).toBeNull()
})

test('stored metadata and legacy records survive omitted quota and disabled accounts', () => {
  const stored = {
    disabled: {
      resetAt: now + 50,
      usedPercent: 100,
      observedAt: '2026-10-03T08:00:00Z',
      credits: { balance: 25, unlimited: false },
    },
    legacy: { resetAt: now + 100, usedPercent: 20 },
    owned: { resetAt: now + 200, usedPercent: 100, disabledByLoop: true },
    gone: { resetAt: now + 300, usedPercent: 0 },
  }
  const credentials = [
    { ...credential('disabled', null), disabled: true },
    credential('legacy', null),
    { ...credential('owned', null), disabled: true },
  ]
  expect(mergeStoredObservations(credentials, stored)).toEqual({
    disabled: stored.disabled,
    legacy: stored.legacy,
    owned: stored.owned,
  })
})

test('enabled credentials relinquish loop ownership before a later manual disable', () => {
  const stored = {
    a: { resetAt: now + 50, usedPercent: 20, disabledByLoop: true, credits: null },
  }
  const enabled = credential('a', null)
  const cleared = mergeStoredObservations([enabled], stored)
  expect(cleared.a).toEqual({ resetAt: now + 50, usedPercent: 20, credits: null })
  const manuallyDisabled = { ...enabled, disabled: true }
  expect(mergeStoredObservations([manuallyDisabled], cleared).a?.disabledByLoop).toBeUndefined()
  expect(
    planDisabled([manuallyDisabled], mergeObservations([manuallyDisabled], cleared, now), new Set())
      .size,
  ).toBe(0)
})

test.each([
  { resetAt: 0, usedPercent: 20 },
  { resetAt: -1, usedPercent: 20 },
  { resetAt: Number.NaN, usedPercent: 20 },
  { resetAt: Number.POSITIVE_INFINITY, usedPercent: 20 },
  { resetAt: 253402300800, usedPercent: 20 },
  { resetAt: now + 50, usedPercent: -1 },
  { resetAt: now + 50, usedPercent: 101 },
  { resetAt: now + 50, usedPercent: Number.NaN },
  { resetAt: now + 50, usedPercent: Number.POSITIVE_INFINITY },
])('malformed weekly observations retain valid history (%j)', (observation) => {
  const stored = {
    a: { resetAt: now + 100, usedPercent: 40, observedAt: '2026-10-03T08:00:00Z' },
  }
  const incoming = credential('a', { ...observation, observedAt: '2026-10-03T09:00:00Z' })
  expect(mergeStoredObservations([incoming], stored)).toEqual(stored)
  expect(mergeStoredObservations([incoming], {})).toEqual({})
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Reset-At': String(observation.resetAt),
      'X-Codex-Primary-Used-Percent': String(observation.usedPercent),
    }),
  ).toBeNull()
  expect(
    readObservation('claude', {
      'Anthropic-Ratelimit-Unified-7d-Reset': String(observation.resetAt),
      'Anthropic-Ratelimit-Unified-7d-Utilization': String(observation.usedPercent / 100),
    }),
  ).toBeNull()
})

test.each([
  { resetAt: 1, usedPercent: 0 },
  { resetAt: 253402300799, usedPercent: 100 },
])('weekly numeric boundaries remain valid (%j)', (observation) => {
  const credentials = [credential('a', observation)]
  expect(mergeStoredObservations(credentials, {})).toEqual({ a: observation })
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Reset-At': String(observation.resetAt),
      'X-Codex-Primary-Used-Percent': String(observation.usedPercent),
    }),
  ).toEqual(observation)
  expect(
    readObservation('claude', {
      'Anthropic-Ratelimit-Unified-7d-Reset': String(observation.resetAt),
      'Anthropic-Ratelimit-Unified-7d-Utilization': String(observation.usedPercent / 100),
    }),
  ).toEqual(observation)
})

test('malformed weekly data still permits independently observed credit absence', () => {
  const stored = {
    a: { resetAt: now + 50, usedPercent: 20, credits: { balance: 25, unlimited: false } },
  }
  const incoming = { ...credential('a', { resetAt: 0, usedPercent: 101 }), credits: null }
  expect(mergeStoredObservations([incoming], stored)).toEqual({ a: { ...stored.a, credits: null } })
})

test('the loop leaves a later manual disable alone after management reports the account enabled', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  const resetAt = Math.floor(Date.now() / 1_000) + 3_600
  await writeFile(keyFile, 'management-key\n')
  await writeFile(
    stateFile,
    JSON.stringify({ a: { resetAt, usedPercent: 20, disabledByLoop: true } }),
  )
  let reads = 0
  let disabled = false
  let priority = 0
  const statuses: boolean[] = []
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (request.method === 'PATCH') {
        const patch = (await request.json()) as { priority: number; disabled: boolean }
        if (pathname.endsWith('/fields')) priority = patch.priority
        if (pathname.endsWith('/status')) {
          statuses.push(patch.disabled)
          disabled = patch.disabled
        }
        return Response.json({ status: 'ok' })
      }
      reads++
      return Response.json({
        files: [{ name: 'a.json', auth_index: 'a', provider: 'codex', disabled, priority }],
      })
    },
  })
  const loop = startResetOrder({
    proxyUrl: upstream.url.toString(),
    managementKeyFile: keyFile,
    stateFile,
    intervalMs: 10,
  })
  try {
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3)
    expect((await Bun.file(stateFile).json()).a.disabledByLoop).toBeUndefined()
    disabled = true
    const before = reads
    await expect.poll(() => reads).toBeGreaterThanOrEqual(before + 3)
    expect(disabled).toBe(true)
    expect(statuses).toEqual([])
    expect((await Bun.file(stateFile).json()).a).toEqual({ resetAt, usedPercent: 20 })
  } finally {
    loop.stop()
    upstream.stop(true)
    await rm(scratch, { recursive: true, force: true })
  }
})

test('malformed current weekly headers preserve the valid policy map', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  const resetAt = Math.floor(Date.now() / 1_000) + 3_600
  const stored = {
    prior: { resetAt, usedPercent: 20, observedAt: '2026-10-03T08:00:00Z' },
    fallback: { resetAt: resetAt + 500, usedPercent: 40, observedAt: '2026-10-03T07:00:00Z' },
  }
  await writeFile(keyFile, 'management-key\n')
  await writeFile(stateFile, JSON.stringify(stored))
  let reads = 0
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      expect(request.method).toBe('GET')
      reads++
      return Response.json({
        files: ['prior', 'unknown', 'fallback'].map((index) => ({
          name: `${index}.json`,
          auth_index: index,
          provider: 'codex',
          disabled: true,
          quota:
            index === 'fallback'
              ? undefined
              : {
                  observed_at: '2026-10-03T09:00:00Z',
                  signals: {
                    'X-Codex-Primary-Reset-At': index === 'prior' ? String(resetAt) : '0',
                    'X-Codex-Primary-Used-Percent': index === 'prior' ? '101' : '20',
                  },
                },
        })),
      })
    },
  })
  const loop = startResetOrder({
    proxyUrl: upstream.url.toString(),
    managementKeyFile: keyFile,
    stateFile,
    intervalMs: 10,
  })
  try {
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3)
    expect(await Bun.file(stateFile).json()).toEqual(stored)
  } finally {
    loop.stop()
    upstream.stop(true)
    await rm(scratch, { recursive: true, force: true })
  }
})

test('new weekly observations replace timestamps and retain omitted credits', () => {
  const stored = {
    a: {
      resetAt: now + 50,
      usedPercent: 20,
      observedAt: '2026-10-03T08:00:00Z',
      credits: { balance: 25, unlimited: false },
      disabledByLoop: true,
    },
  }
  const credentials = [
    {
      ...credential('a', {
        resetAt: now + 70,
        usedPercent: 40,
        observedAt: '2026-10-03T09:00:00Z',
      }),
      disabled: true,
    },
  ]
  const state = mergeStoredObservations(credentials, stored)
  expect(state.a).toEqual({
    ...stored.a,
    resetAt: now + 70,
    usedPercent: 40,
    observedAt: '2026-10-03T09:00:00Z',
  })
  expect(mergeObservations(credentials, state, now).a).toEqual({
    resetAt: now + 70,
    usedPercent: 40,
    observedAt: '2026-10-03T09:00:00Z',
    credits: stored.a.credits,
  })
  credentials[0]!.observation = { resetAt: now + 80, usedPercent: 50 }
  expect(mergeStoredObservations(credentials, state).a).toEqual({
    resetAt: now + 80,
    usedPercent: 50,
    credits: stored.a.credits,
    disabledByLoop: true,
  })
})

test('credits-only updates retain historical weekly freshness and explicitly clear credits', () => {
  const stored = {
    a: {
      resetAt: now + 50,
      usedPercent: 20,
      observedAt: '2026-10-03T08:00:00Z',
      credits: { balance: 25, unlimited: false },
    },
  }
  const credits = { balance: 10, unlimited: true }
  const updated = mergeStoredObservations([{ ...credential('a', null), credits }], stored)
  expect(updated.a).toEqual({ ...stored.a, credits })
  const cleared = mergeStoredObservations([{ ...credential('a', null), credits: null }], updated)
  expect(cleared.a).toEqual({
    resetAt: now + 50,
    usedPercent: 20,
    observedAt: stored.a.observedAt,
    credits: null,
  })
  expect(mergeStoredObservations([credential('a', null)], cleared)).toEqual(cleared)
})

test('missing or malformed credit signals preserve the last observed credits', () => {
  const stored = {
    a: {
      resetAt: now + 50,
      usedPercent: 20,
      observedAt: '2026-10-03T08:00:00Z',
      credits: { balance: 25, unlimited: false },
    },
  }
  expect(
    mergeStoredObservations([{ ...credential('a', null), credits: undefined }], stored),
  ).toEqual(stored)
})

test('credits-only accounts persist without invented weekly data and never enter routing', () => {
  const credits = { balance: 10, unlimited: false }
  const credentials = [{ ...credential('a', null), credits }]
  const state = mergeStoredObservations(credentials, {})
  expect(state).toEqual({ a: { credits } })
  expect(mergeStoredObservations([credential('a', null)], state)).toEqual(state)
  const observations = mergeObservations(credentials, state, now)
  expect(observations).toEqual({})
  expect(planPriorities(credentials, observations).get('a.json')).toBe(0)
  expect(planDisabled(credentials, observations, new Set()).size).toBe(0)
  const cleared = mergeStoredObservations([{ ...credential('a', null), credits: null }], state)
  expect(cleared).toEqual({ a: { credits: null } })
  expect(mergeStoredObservations([credential('a', null)], cleared)).toEqual(cleared)
  expect(mergeObservations(credentials, cleared, now)).toEqual({})
})

test('confirmed credit absence replaces positive credits and survives fresh weekly headers', () => {
  const stored = {
    a: { resetAt: now + 50, usedPercent: 20, credits: { balance: 25, unlimited: false } },
  }
  const cleared = mergeStoredObservations([{ ...credential('a', null), credits: null }], stored)
  const restored = JSON.parse(JSON.stringify(cleared)) as Record<string, StoredObservation>
  const observation = readObservation('codex', {
    'X-Codex-Primary-Reset-At': String(now + 50),
    'X-Codex-Primary-Used-Percent': '20',
    'X-Codex-Credits-Has-Credits': 'false',
    'X-Codex-Credits-Unlimited': 'false',
  })
  expect(mergeStoredObservations([credential('a', observation)], stored)).toEqual(cleared)
  expect(restored.a).toEqual({ resetAt: now + 50, usedPercent: 20, credits: null })
  expect(
    mergeStoredObservations([credential('a', { resetAt: now + 70, usedPercent: 40 })], restored),
  ).toEqual({ a: { resetAt: now + 70, usedPercent: 40, credits: null } })
})

test('the loop retains confirmed credit absence after restart with omitted quota', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  const stored = {
    weekly: {
      resetAt: Math.floor(Date.now() / 1_000) + 3_600,
      usedPercent: 20,
      observedAt: '2026-10-03T08:00:00Z',
      credits: null,
    },
    'credits-only': { credits: null },
  }
  await writeFile(keyFile, 'management-key\n')
  await writeFile(stateFile, JSON.stringify(stored))
  let reads = 0
  const logs: Record<string, unknown>[] = []
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    logs.push(JSON.parse(String(chunk)))
    return true
  })
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      expect(request.method).toBe('GET')
      reads++
      return Response.json({
        files: ['weekly', 'credits-only'].map((index) => ({
          name: `${index}.json`,
          auth_index: index,
          provider: 'codex',
          disabled: true,
        })),
      })
    },
  })
  const loop = startResetOrder({
    proxyUrl: upstream.url.toString(),
    managementKeyFile: keyFile,
    stateFile,
    intervalMs: 10,
  })
  try {
    await expect.poll(() => reads).toBeGreaterThanOrEqual(3)
    expect(logs).toEqual([])
    expect(await Bun.file(stateFile).json()).toEqual(stored)
  } finally {
    loop.stop()
    upstream.stop(true)
    stderr.mockRestore()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('expired weekly data remains persisted while routing treats it as unknown', () => {
  const stored: Record<string, StoredObservation> = {
    a: {
      resetAt: now - 1,
      usedPercent: 100,
      observedAt: '2026-10-03T08:00:00Z',
      credits: { balance: 25, unlimited: false },
    },
  }
  const credentials = [credential('a', null)]
  expect(mergeStoredObservations(credentials, stored)).toEqual(stored)
  expect(mergeObservations(credentials, stored, now)).toEqual({})
})

test('equal resets order by auth index so the plan stays stable', () => {
  const credentials = [
    credential('b', { resetAt: now + 10, usedPercent: 0 }),
    credential('a', { resetAt: now + 10, usedPercent: 0 }),
  ]
  const priorities = planPriorities(credentials, mergeObservations(credentials, {}, now))
  expect(priorities.get('a.json')).toBe(2)
  expect(priorities.get('b.json')).toBe(1)
})

test('signals without a numeric reset or usage give no observation', () => {
  expect(readObservation('codex', undefined)).toBeNull()
  expect(readObservation('codex', { 'X-Codex-Primary-Reset-At': '12' })).toBeNull()
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Reset-At': '12',
      'X-Codex-Primary-Used-Percent': 'x',
    }),
  ).toBeNull()
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Reset-At': '12',
      'X-Codex-Primary-Used-Percent': '94',
    }),
  ).toEqual({ resetAt: 12, usedPercent: 94 })
})

test('the Codex weekly window can be secondary and a five-hour window cannot disable an account', () => {
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Window-Minutes': '300',
      'X-Codex-Primary-Reset-At': '12',
      'X-Codex-Primary-Used-Percent': '100',
      'X-Codex-Secondary-Window-Minutes': '10080',
      'X-Codex-Secondary-Reset-At': '24',
      'X-Codex-Secondary-Used-Percent': '50',
    }),
  ).toEqual({ resetAt: 24, usedPercent: 50 })
  expect(
    readObservation('codex', {
      'X-Codex-Primary-Window-Minutes': '300',
      'X-Codex-Primary-Reset-At': '12',
      'X-Codex-Primary-Used-Percent': '100',
    }),
  ).toBeNull()
})

test('Claude weekly signals read as reset seconds and percent used', () => {
  expect(readObservation('claude', undefined)).toBeNull()
  expect(readObservation('claude', { 'Anthropic-Ratelimit-Unified-7d-Reset': '12' })).toBeNull()
  expect(
    readObservation('claude', {
      'Anthropic-Ratelimit-Unified-7d-Reset': '12',
      'Anthropic-Ratelimit-Unified-7d-Utilization': '0.42',
      'Anthropic-Ratelimit-Unified-5h-Utilization': '0.99',
    }),
  ).toEqual({ resetAt: 12, usedPercent: 42 })
  expect(
    readObservation('claude', {
      'Anthropic-Ratelimit-Unified-7d-Reset': '1970-01-01T00:00:20Z',
      'Anthropic-Ratelimit-Unified-7d-Utilization': '0.5',
      'Anthropic-Ratelimit-Unified-7d-Status': 'rejected',
    }),
  ).toEqual({ resetAt: 20, usedPercent: 100 })
  // Codex signal names mean nothing on a Claude account, and the reverse.
  expect(
    readObservation('claude', {
      'X-Codex-Primary-Reset-At': '12',
      'X-Codex-Primary-Used-Percent': '94',
    }),
  ).toBeNull()
})

test('Claude and Codex accounts rank separately', () => {
  const credentials = [
    credential('codex-late', { resetAt: now + 500, usedPercent: 10 }),
    credential('codex-soon', { resetAt: now + 100, usedPercent: 10 }),
    credential('claude-late', { resetAt: now + 900, usedPercent: 10 }, 'claude'),
    credential('claude-soon', { resetAt: now + 50, usedPercent: 99 }, 'claude'),
    credential('claude-spent', { resetAt: now + 10, usedPercent: 100 }, 'claude'),
  ]
  const priorities = planPriorities(credentials, mergeObservations(credentials, {}, now))
  expect(Object.fromEntries(priorities)).toEqual({
    'codex-soon.json': 2,
    'codex-late.json': 1,
    'claude-soon.json': 2,
    'claude-late.json': 1,
    'claude-spent.json': -1,
  })
})

test('spent Codex accounts disable while an enabled account has weekly quota', () => {
  const credentials = [
    credential('spent', { resetAt: now + 100, usedPercent: 100 }),
    credential('usable', { resetAt: now + 500, usedPercent: 0 }),
    credential('claude', { resetAt: now + 100, usedPercent: 100 }, 'claude'),
  ]
  const observations = mergeObservations(credentials, {}, now)
  expect(Object.fromEntries(planDisabled(credentials, observations, new Set()))).toEqual({
    spent: true,
  })
})

test('only loop-owned accounts re-enable for credits or a passed reset', () => {
  const credentials = [
    { ...credential('owned', { resetAt: now + 100, usedPercent: 100 }), disabled: true },
    { ...credential('manual', { resetAt: now - 100, usedPercent: 0 }), disabled: true },
    credential('spent', { resetAt: now + 500, usedPercent: 100 }),
  ]
  const owned = new Set(['owned'])
  expect(
    Object.fromEntries(planDisabled(credentials, mergeObservations(credentials, {}, now), owned)),
  ).toEqual({ owned: false })
  credentials[0]!.observation = { resetAt: now - 1, usedPercent: 100 }
  credentials[2]!.observation = { resetAt: now + 500, usedPercent: 10 }
  expect(
    Object.fromEntries(planDisabled(credentials, mergeObservations(credentials, {}, now), owned)),
  ).toEqual({ owned: false })
})

test('unknown or manually disabled accounts do not prove weekly quota is available', () => {
  const credentials = [
    credential('spent', { resetAt: now + 100, usedPercent: 100 }),
    credential('unknown', null),
    { ...credential('manual', { resetAt: now + 200, usedPercent: 0 }), disabled: true },
    credential('claude', { resetAt: now + 200, usedPercent: 0 }, 'claude'),
  ]
  expect(planDisabled(credentials, mergeObservations(credentials, {}, now), new Set()).size).toBe(0)
})

test('the loop patches only changed priorities and records observations', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const resetAt = String(Math.floor(Date.now() / 1_000) + 3_600)
  const patches: { name: string; priority: number }[] = []
  let soonPriority: number | null = null
  let claudePriority: number | null = null
  let ticks = 0
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      expect(request.headers.get('authorization')).toBe('Bearer management-key')
      const { pathname } = new URL(request.url)
      if (request.method === 'PATCH' && pathname === '/v0/management/auth-files/fields') {
        const patch = (await request.json()) as { name: string; priority: number }
        patches.push(patch)
        if (patch.name === 'soon.json') soonPriority = patch.priority
        if (patch.name === 'claude.json') claudePriority = patch.priority
        return Response.json({ status: 'ok' })
      }
      expect(pathname).toBe('/v0/management/auth-files')
      ticks++
      return Response.json({
        files: [
          {
            name: 'soon.json',
            auth_index: 'soon',
            provider: 'codex',
            priority: soonPriority,
            quota:
              ticks === 1
                ? {
                    observed_at: '2026-10-03T09:00:00Z',
                    signals: {
                      'X-Codex-Primary-Reset-At': resetAt,
                      'X-Codex-Primary-Used-Percent': '10',
                      'X-Codex-Credits-Has-Credits': '1',
                      'X-Codex-Credits-Unlimited': 'FALSE',
                      'X-Codex-Credits-Balance': '25',
                    },
                  }
                : undefined,
          },
          { name: 'new.json', auth_index: 'new', provider: 'codex', quota: { signals: {} } },
          {
            name: 'claude.json',
            auth_index: 'claude',
            provider: 'claude',
            priority: claudePriority,
            quota: {
              observed_at: '2026-10-03T09:00:00Z',
              signals: {
                'Anthropic-Ratelimit-Unified-7d-Reset': resetAt,
                'Anthropic-Ratelimit-Unified-7d-Utilization': '0.25',
              },
            },
          },
          {
            name: 'off.json',
            auth_index: 'off',
            provider: 'codex',
            disabled: true,
            priority: 7,
            quota: {
              observed_at: '2026-10-03T10:00:00Z',
              signals: {
                'X-Codex-Credits-Has-Credits': 'FaLsE',
                'X-Codex-Credits-Unlimited': '0',
              },
            },
          },
          {
            name: 'credit-only.json',
            auth_index: 'credit-only',
            provider: 'codex',
            quota: {
              observed_at: '2026-10-03T10:00:00Z',
              signals: {
                'X-Codex-Credits-Has-Credits': '0',
                'X-Codex-Credits-Unlimited': 'TrUe',
                'X-Codex-Credits-Balance': '50',
              },
            },
          },
          { name: 'legacy.json', auth_index: 'legacy', provider: 'codex', disabled: true },
          {
            name: 'manual.json',
            auth_index: 'manual',
            provider: 'codex',
            disabled: true,
            quota: {
              observed_at: '2026-10-03T09:00:00Z',
              signals: {
                'X-Codex-Primary-Reset-At': resetAt,
                'X-Codex-Primary-Used-Percent': '100',
                'X-Codex-Credits-Has-Credits': 'True',
                'X-Codex-Credits-Unlimited': 'False',
                'X-Codex-Credits-Balance': '5',
              },
            },
          },
          { name: 'gemini.json', auth_index: 'gemini', provider: 'gemini', priority: 7 },
        ],
      })
    },
  })
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  await writeFile(keyFile, 'management-key\n')
  const legacy = { resetAt: Number(resetAt), usedPercent: 70 }
  await writeFile(
    stateFile,
    JSON.stringify({
      off: {
        ...legacy,
        observedAt: '2026-10-03T08:00:00Z',
        credits: { balance: 100, unlimited: false },
      },
      legacy,
    }),
  )
  const loop = startResetOrder({
    proxyUrl: upstream.url.toString(),
    managementKeyFile: keyFile,
    stateFile,
    intervalMs: 10,
  })
  try {
    await expect.poll(() => ticks).toBeGreaterThanOrEqual(3)
    expect(patches).toEqual([
      { name: 'soon.json', priority: 1 },
      { name: 'claude.json', priority: 1 },
    ])
    expect(await Bun.file(stateFile).json()).toEqual({
      soon: {
        resetAt: Number(resetAt),
        usedPercent: 10,
        observedAt: '2026-10-03T09:00:00Z',
        credits: { balance: 25, unlimited: false },
      },
      claude: { resetAt: Number(resetAt), usedPercent: 25, observedAt: '2026-10-03T09:00:00Z' },
      off: { ...legacy, observedAt: '2026-10-03T08:00:00Z', credits: null },
      'credit-only': { credits: { balance: 50, unlimited: true } },
      legacy,
      manual: {
        resetAt: Number(resetAt),
        usedPercent: 100,
        observedAt: '2026-10-03T09:00:00Z',
        credits: { balance: 5, unlimited: false },
      },
    })
  } finally {
    loop.stop()
    upstream.stop(true)
    await rm(scratch, { recursive: true, force: true })
  }
})

test.each(['last-resort', 'reset-passed'])(
  'the loop owns disables across restart and releases them on %s',
  async (reason) => {
    const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
    const keyFile = join(scratch, 'key')
    const stateFile = join(scratch, 'state.json')
    await writeFile(keyFile, 'management-key\n')
    const future = Math.floor(Date.now() / 1_000) + 3_600
    const files = [
      {
        ...credential('spent', { resetAt: future, usedPercent: 100 }),
        plan_type: 'pro',
        credits: '62500',
      },
      {
        ...credential('usable', { resetAt: future + 3_600, usedPercent: 0 }),
        plan_type: 'prolite',
        credits: '0',
      },
      {
        ...credential('manual', { resetAt: future, usedPercent: 100 }),
        disabled: true,
        plan_type: 'pro',
        credits: '0',
      },
    ]
    const statuses: { name: string; auth_index: string; disabled: boolean }[] = []
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        expect(request.headers.get('authorization')).toBe('Bearer management-key')
        const { pathname } = new URL(request.url)
        if (request.method === 'PATCH') {
          const patch = (await request.json()) as {
            name: string
            auth_index: string
            disabled: boolean
            priority: number
          }
          const file = files.find((entry) => entry.name === patch.name)!
          if (pathname.endsWith('/status')) {
            statuses.push({
              name: patch.name,
              auth_index: patch.auth_index,
              disabled: patch.disabled,
            })
            expect(patch.auth_index).toBe(file.index)
            file.disabled = patch.disabled
          } else {
            expect(pathname).toBe('/v0/management/auth-files/fields')
            expect(file.disabled).toBe(false)
            file.priority = patch.priority
          }
          return Response.json({ status: 'ok' })
        }
        return Response.json({
          files: files.map((file) => ({
            name: file.name,
            auth_index: file.index,
            provider: file.provider,
            disabled: file.disabled,
            priority: file.priority,
            id_token: { plan_type: file.plan_type },
            quota: {
              observed_at: file.observation ? '2026-10-03T09:00:00Z' : undefined,
              signals: file.observation
                ? {
                    'X-Codex-Primary-Window-Minutes': '10080',
                    'X-Codex-Primary-Reset-At': String(file.observation.resetAt),
                    'X-Codex-Primary-Used-Percent': String(file.observation.usedPercent),
                    'X-Codex-Credits-Has-Credits': 'True',
                    'X-Codex-Credits-Unlimited': 'False',
                    'X-Codex-Credits-Balance': file.credits,
                    'X-Codex-Active-Limit': 'premium',
                  }
                : {},
            },
          })),
        })
      },
    })
    const options = {
      proxyUrl: upstream.url.toString(),
      managementKeyFile: keyFile,
      stateFile,
      intervalMs: 10,
    }
    let loop = startResetOrder(options)
    try {
      await expect
        .poll(async () => (await Bun.file(stateFile).json()).spent?.disabledByLoop)
        .toBe(true)
      expect(statuses).toEqual([{ name: 'spent.json', auth_index: 'spent', disabled: true }])
      loop.stop()
      // Restart clears the proxy's telemetry, while ownership and quota survive on disk.
      files[0]!.observation = null
      files[1]!.observation = null
      const stored = await Bun.file(stateFile).json()
      expect(stored.spent).toMatchObject({
        observedAt: '2026-10-03T09:00:00Z',
        credits: { balance: 62500, unlimited: false },
        disabledByLoop: true,
      })
      if (reason === 'last-resort') stored.usable.usedPercent = 100
      if (reason === 'reset-passed') stored.spent.resetAt = Math.floor(Date.now() / 1_000) - 1
      await writeFile(stateFile, JSON.stringify(stored))
      loop = startResetOrder(options)
      await expect
        .poll(async () => (await Bun.file(stateFile).json()).spent?.disabledByLoop ?? false)
        .toBe(false)
      expect(statuses).toEqual([
        { name: 'spent.json', auth_index: 'spent', disabled: true },
        { name: 'spent.json', auth_index: 'spent', disabled: false },
      ])
      expect(files[2]!.disabled).toBe(true)
      const retained = (await Bun.file(stateFile).json()).spent
      expect(retained.observedAt).toBe(stored.spent.observedAt)
      expect(retained.credits).toEqual(stored.spent.credits)
      expect(retained.resetAt).toBe(stored.spent.resetAt)
      expect(retained.disabledByLoop).toBeUndefined()
    } finally {
      loop.stop()
      upstream.stop(true)
      await rm(scratch, { recursive: true, force: true })
    }
  },
)

test('ownership survives a proxy-applied disable with an unreadable acknowledgement', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  await writeFile(keyFile, 'management-key\n')
  let attempts = 0
  let disabled = false
  let usablePercent = '0'
  const resetAt = String(Math.floor(Date.now() / 1_000) + 3_600)
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method === 'PATCH') {
        const patch = (await request.json()) as { disabled?: boolean }
        if (new URL(request.url).pathname.endsWith('/fields'))
          return Response.json({ status: 'ok' })
        attempts++
        disabled = patch.disabled!
        if (attempts === 1) return new Response('invalid-json', { status: 200 })
        return Response.json({ status: 'ok' })
      }
      return Response.json({
        files: ['spent', 'usable'].map((index) => ({
          name: `${index}.json`,
          auth_index: index,
          provider: 'codex',
          disabled: index === 'spent' && disabled,
          quota: {
            signals: {
              'X-Codex-Primary-Reset-At': resetAt,
              'X-Codex-Primary-Used-Percent': index === 'spent' ? '100' : usablePercent,
            },
          },
        })),
      })
    },
  })
  const loop = startResetOrder({
    proxyUrl: upstream.url.toString(),
    managementKeyFile: keyFile,
    stateFile,
    intervalMs: 10,
  })
  try {
    await expect.poll(() => attempts).toBe(1)
    expect(disabled).toBe(true)
    expect((await Bun.file(stateFile).json()).spent.disabledByLoop).toBe(true)
    usablePercent = '100'
    await expect
      .poll(async () => (await Bun.file(stateFile).json()).spent?.disabledByLoop ?? false)
      .toBe(false)
    expect(disabled).toBe(false)
    expect(attempts).toBe(2)
  } finally {
    loop.stop()
    upstream.stop(true)
    await rm(scratch, { recursive: true, force: true })
  }
})

test('unknown remaining quota keeps a spent loop-owned account disabled', () => {
  const credentials = [
    { ...credential('spent', { resetAt: now + 100, usedPercent: 100 }), disabled: true },
    credential('unknown', null),
  ]
  expect(
    planDisabled(credentials, mergeObservations(credentials, {}, now), new Set(['spent'])).size,
  ).toBe(0)
})

test.each([
  'invalid-json',
  '{"spent":{"resetAt":9999999999,"usedPercent":100,"disabledByLoop":true},"broken":{}}',
  '{"spent":{"resetAt":0,"usedPercent":100,"disabledByLoop":true}}',
  '{"spent":{"resetAt":253402300800,"usedPercent":100,"disabledByLoop":true}}',
  '{"spent":{"resetAt":1e999,"usedPercent":100,"disabledByLoop":true}}',
  '{"spent":{"resetAt":9999999999,"usedPercent":101,"disabledByLoop":true}}',
  '{"spent":{"resetAt":9999999999,"usedPercent":-1,"disabledByLoop":true}}',
])('invalid state reaches give-up without erasing ownership (%s)', async (contents) => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  await writeFile(keyFile, 'management-key\n')
  await writeFile(stateFile, contents)
  let reads = 0
  const logs: Record<string, unknown>[] = []
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    logs.push(JSON.parse(String(chunk)))
    return true
  })
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      expect(request.method).toBe('GET')
      reads++
      return Response.json({
        files: [{ name: 'spent.json', auth_index: 'spent', provider: 'codex', disabled: true }],
      })
    },
  })
  const loop = startResetOrder({
    proxyUrl: upstream.url.toString(),
    managementKeyFile: keyFile,
    stateFile,
    intervalMs: 1,
  })
  try {
    await expect.poll(() => logs.some((event) => event.state === 'gave-up')).toBe(true)
    expect(reads).toBe(10)
    expect(logs.map((event) => event.state)).toEqual(['failing', 'gave-up'])
    expect(await Bun.file(stateFile).text()).toBe(contents)
  } finally {
    loop.stop()
    upstream.stop(true)
    stderr.mockRestore()
    await rm(scratch, { recursive: true, force: true })
  }
})
