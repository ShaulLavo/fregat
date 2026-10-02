import { expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeObservations,
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
            quota: {
              signals: {
                'X-Codex-Primary-Reset-At': resetAt,
                'X-Codex-Primary-Used-Percent': '10',
              },
            },
          },
          { name: 'new.json', auth_index: 'new', provider: 'codex', quota: { signals: {} } },
          {
            name: 'claude.json',
            auth_index: 'claude',
            provider: 'claude',
            priority: claudePriority,
            quota: {
              signals: {
                'Anthropic-Ratelimit-Unified-7d-Reset': resetAt,
                'Anthropic-Ratelimit-Unified-7d-Utilization': '0.25',
              },
            },
          },
          { name: 'off.json', auth_index: 'off', provider: 'claude', disabled: true, priority: 7 },
          { name: 'gemini.json', auth_index: 'gemini', provider: 'gemini', priority: 7 },
        ],
      })
    },
  })
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  await writeFile(keyFile, 'management-key\n')
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
      soon: { resetAt: Number(resetAt), usedPercent: 10 },
      claude: { resetAt: Number(resetAt), usedPercent: 25 },
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
              signals: file.observation
                ? {
                    'X-Codex-Primary-Window-Minutes': '10080',
                    'X-Codex-Primary-Reset-At': String(file.observation.resetAt),
                    'X-Codex-Primary-Used-Percent': String(file.observation.usedPercent),
                    'X-Codex-Credits-Has-Credits': 'True',
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
    } finally {
      loop.stop()
      upstream.stop(true)
      await rm(scratch, { recursive: true, force: true })
    }
  },
)

test('a failed disable is not recorded as loop ownership', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const keyFile = join(scratch, 'key')
  const stateFile = join(scratch, 'state.json')
  await writeFile(keyFile, 'management-key\n')
  let attempts = 0
  const resetAt = String(Math.floor(Date.now() / 1_000) + 3_600)
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (request.method === 'PATCH') {
        expect(new URL(request.url).pathname).toBe('/v0/management/auth-files/status')
        attempts++
        return Response.json({ status: 'unavailable' }, { status: 503 })
      }
      return Response.json({
        files: ['spent', 'usable'].map((index) => ({
          name: `${index}.json`,
          auth_index: index,
          provider: 'codex',
          disabled: false,
          quota: {
            signals: {
              'X-Codex-Primary-Reset-At': resetAt,
              'X-Codex-Primary-Used-Percent': index === 'spent' ? '100' : '0',
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
    await expect.poll(() => attempts).toBeGreaterThanOrEqual(1)
    expect((await Bun.file(stateFile).json()).spent.disabledByLoop).toBeUndefined()
  } finally {
    loop.stop()
    upstream.stop(true)
    await rm(scratch, { recursive: true, force: true })
  }
})
