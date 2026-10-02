import { expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchChromium } from '../chromium'
import { startupBudget, startupSupervisor, type StartupBudget } from '../startup'
import type { BrowserCandidate } from '../browser'

async function startupFixture(mode: string) {
  const root = await mkdtemp(
    path.join(existsSync('/work/tmp') ? '/work/tmp' : tmpdir(), 'polaron-startup-'),
  )
  const pidFile = path.join(root, 'pid')
  const candidate: BrowserCandidate = {
    kind: 'chromium',
    executable: process.execPath,
    args: [path.join(import.meta.dirname, 'fixtures/browser.mjs'), mode, pidFile],
    confinement: 'none',
    source: 'setting',
    family: 'fixture',
  }
  let owned: Awaited<ReturnType<typeof launchChromium>> | undefined
  const launch = async (
    startup: StartupBudget,
    observe?: (pid: number) => Record<string, number>,
  ) => {
    owned = await launchChromium({
      candidate,
      stateHome: root,
      home: root,
      url: 'http://localhost:123/',
      startup,
      observe,
      onOpen: () => {},
      onFailure: () => {},
    })
    return owned
  }
  const reaped = async () => {
    try {
      process.kill(Number(await readFile(pidFile, 'utf8')), 0)
      return false
    } catch {
      return true
    }
  }
  return {
    launch,
    reaped,
    cleanup: async () => {
      if (owned?.kind === 'owned') await owned.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

function clock() {
  let at = 0
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

test('budget defaults come from the settings registry and valid values override them', () => {
  expect(startupBudget()).toEqual({ idleMs: 5000, limitMs: 60_000 })
  expect(
    startupBudget({
      'window.browserStartupIdleSeconds': 2,
      'window.browserStartupLimitSeconds': 'private',
    }),
  ).toEqual({ idleMs: 2000, limitMs: 60_000 })
})

test('a rising counter renews the idle window and a flat one stalls at the idle bound', () => {
  const time = clock()
  const supervisor = startupSupervisor({ idleMs: 1000, limitMs: 10_000 }, time.now)
  expect(supervisor.check({ faults: 10 })).toBe('progressing')
  for (let step = 1; step <= 8; step++) {
    time.advance(900)
    expect(supervisor.check({ faults: 10 + step })).toBe('progressing')
  }
  time.advance(900)
  expect(supervisor.check({ faults: 18 })).toBe('progressing')
  time.advance(100)
  expect(supervisor.check({ faults: 18 })).toBe('startup-stalled')
})

test('unavailable, non-finite, reset and decreasing counters never renew the budget', () => {
  const time = clock()
  const supervisor = startupSupervisor({ idleMs: 1000, limitMs: 10_000 }, time.now)
  supervisor.check({ faults: 100, cpu: null })
  time.advance(400)
  expect(supervisor.check({ faults: 5, cpu: null })).toBe('progressing')
  time.advance(400)
  expect(supervisor.check({ faults: 100, cpu: Number.NaN })).toBe('progressing')
  time.advance(200)
  expect(supervisor.check({ faults: 50, cpu: Number.POSITIVE_INFINITY })).toBe('startup-stalled')
  time.advance(100)
  expect(supervisor.check({ faults: 101, cpu: null })).toBe('progressing')
})

test('the cap wins over continuing progress and over a longer idle window', () => {
  const time = clock()
  const steady = startupSupervisor({ idleMs: 1000, limitMs: 3000 }, time.now)
  for (let step = 0; step < 6; step++) {
    expect(steady.check({ bytes: step })).toBe('progressing')
    time.advance(500)
  }
  expect(steady.check({ bytes: 6 })).toBe('startup-limit')
  const short = startupSupervisor({ idleMs: 5000, limitMs: 1000 }, time.now)
  time.advance(1000)
  expect(short.check({ bytes: 1 })).toBe('startup-limit')
  expect(short.remainingMs()).toBe(0)
})

test.each(['slow-version', 'slow-attach'])(
  'a browser still loading past the idle window during %s is owned once it answers',
  async (mode) => {
    const f = await startupFixture(mode)
    try {
      const window = await f.launch(startupBudget())
      expect(window.kind).toBe('owned')
      if (window.kind === 'owned') await window.close()
    } finally {
      await f.cleanup()
    }
  },
  15_000,
)

test('a live browser whose counters stay flat fails at the idle bound and is reaped', async () => {
  const f = await startupFixture('silent')
  const started = performance.now()
  try {
    await expect(
      f.launch({ idleMs: 500, limitMs: 10_000 }, () => ({ faults: 7 })),
    ).rejects.toMatchObject({ internal: { reason: 'startup-stalled', startupPhase: 'version' } })
    expect(performance.now() - started).toBeLessThan(2500)
    expect(await f.reaped()).toBe(true)
  } finally {
    await f.cleanup()
  }
})

test('a browser that keeps progressing without answering fails at the cap and is reaped', async () => {
  const f = await startupFixture('silent')
  let faults = 0
  const started = performance.now()
  try {
    await expect(
      f.launch({ idleMs: 300, limitMs: 1500 }, () => ({ faults: ++faults })),
    ).rejects.toMatchObject({ internal: { reason: 'startup-limit' } })
    const waited = performance.now() - started
    expect(waited).toBeGreaterThanOrEqual(1500)
    expect(waited).toBeLessThan(4000)
    expect(await f.reaped()).toBe(true)
  } finally {
    await f.cleanup()
  }
})

test('a longer idle window cannot extend cap rejection or owned-child cleanup', async () => {
  const f = await startupFixture('silent')
  const started = performance.now()
  try {
    await expect(
      f.launch({ idleMs: 3000, limitMs: 1000 }, () => ({ faults: 7 })),
    ).rejects.toMatchObject({ internal: { reason: 'startup-limit', startupPhase: 'version' } })
    const waited = performance.now() - started
    expect(waited).toBeGreaterThanOrEqual(1000)
    expect(waited).toBeLessThan(2000)
    expect(await f.reaped()).toBe(true)
  } finally {
    await f.cleanup()
  }
})

test('a browser that exits during the startup attach fails promptly', async () => {
  const f = await startupFixture('exit-attach')
  const started = performance.now()
  try {
    await expect(f.launch(startupBudget())).rejects.toThrow()
    expect(performance.now() - started).toBeLessThan(2000)
    expect(await f.reaped()).toBe(true)
  } finally {
    await f.cleanup()
  }
})

test('initial page preparation keeps startup progress supervision until its bridge is ready', async () => {
  const f = await startupFixture('slow-page')
  const started = performance.now()
  let window: Awaited<ReturnType<typeof f.launch>> | undefined
  try {
    window = await f.launch(startupBudget())
    expect(window.kind).toBe('owned')
    expect(performance.now() - started).toBeGreaterThanOrEqual(6000)
    if (window.kind === 'owned')
      await expect(window.cdp.request('Browser.getVersion')).resolves.toHaveProperty('product')
  } finally {
    if (window?.kind === 'owned') await window.close()
    expect(await f.reaped()).toBe(true)
    await f.cleanup()
  }
}, 15_000)

test.each([
  { reason: 'startup-stalled', advancing: false, budget: { idleMs: 300, limitMs: 1500 } },
  { reason: 'startup-limit', advancing: true, budget: { idleMs: 300, limitMs: 1500 } },
])(
  'initial page preparation fails at $reason and reaps its owner',
  async ({ reason, advancing, budget }) => {
    const f = await startupFixture('silent-page')
    let faults = 0
    try {
      const launch = f.launch(budget, () => ({ faults: advancing ? ++faults : 7 }))
      await expect(launch).rejects.toMatchObject({ internal: { reason, startupPhase: 'attach' } })
      expect(await f.reaped()).toBe(true)
    } finally {
      await f.cleanup()
    }
  },
)

test('initial page protocol rejection fails launch before ownership and reaps its child', async () => {
  const f = await startupFixture('reject-page')
  try {
    await expect(f.launch(startupBudget())).rejects.toMatchObject({
      internal: { reason: 'request-error', method: 'Page.enable', protocolCode: -1 },
    })
    expect(await f.reaped()).toBe(true)
  } finally {
    await f.cleanup()
  }
})
