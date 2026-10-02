import { expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeObservations,
  planPriorities,
  readObservation,
  startResetOrder,
  type Credential,
} from './reset-order'

const now = 1_000_000

function credential(index: string, observation: Credential['observation'], priority = 0) {
  return { name: `${index}.json`, index, priority, observation }
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
  expect(readObservation(undefined)).toBeNull()
  expect(readObservation({ 'X-Codex-Primary-Reset-At': '12' })).toBeNull()
  expect(
    readObservation({ 'X-Codex-Primary-Reset-At': '12', 'X-Codex-Primary-Used-Percent': 'x' }),
  ).toBeNull()
  expect(
    readObservation({ 'X-Codex-Primary-Reset-At': '12', 'X-Codex-Primary-Used-Percent': '94' }),
  ).toEqual({ resetAt: 12, usedPercent: 94 })
})

test('the loop patches only changed priorities and records observations', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'reset-order-'))
  const resetAt = String(Math.floor(Date.now() / 1_000) + 3_600)
  const patches: { name: string; priority: number }[] = []
  let soonPriority: number | null = null
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
        soonPriority = patch.priority
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
          { name: 'claude.json', auth_index: 'other', provider: 'claude', priority: 7 },
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
    expect(patches).toEqual([{ name: 'soon.json', priority: 1 }])
    expect(await Bun.file(stateFile).json()).toEqual({
      soon: { resetAt: Number(resetAt), usedPercent: 10 },
    })
  } finally {
    loop.stop()
    upstream.stop(true)
    await rm(scratch, { recursive: true, force: true })
  }
})
