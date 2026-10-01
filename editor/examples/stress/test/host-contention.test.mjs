import { beforeEach, expect, test, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { startHostCpuEstimate } from '../host-contention.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => '100') }))
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(() => Promise.reject(new TypeError('counter unavailable'))),
  readdir: vi.fn(() => Promise.resolve([])),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readFile).mockReset().mockRejectedValue(new TypeError('counter unavailable'))
  vi.mocked(readdir).mockReset().mockResolvedValue([])
})

test.each(['darwin', 'win32'])(
  'returns an unsupported receipt on %s without reading counters',
  async (platform) => {
    const stop = await startHostCpuEstimate({ platform })
    expect(await stop()).toMatchObject({
      supported: false,
      platform,
      reason: 'Linux CPU counters are unavailable on this host',
    })
    expect(execFileSync).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
    expect(readdir).not.toHaveBeenCalled()
  },
)

test('unavailable Linux affinity is an optional diagnostic, not a run failure', async () => {
  const stop = await startHostCpuEstimate({ platform: 'linux' })
  expect(await stop()).toMatchObject({ supported: false, platform: 'linux' })
})

function linuxCounters() {
  let ticks = 0
  vi.mocked(readdir).mockResolvedValue([String(process.pid)])
  vi.mocked(readFile).mockImplementation(async (path) => {
    if (path.endsWith('/status')) return 'Cpus_allowed_list: 0'
    if (path === '/proc/stat') return `cpu0 ${++ticks * 2} 0 0 0 0 0 0 0`
    const fields = ['S', '0', ...Array(9).fill('0'), '1', '0', '0', '0']
    return `${process.pid} (runner) ${fields.join(' ')}`
  })
}

test('available Linux counters keep the signed residual diagnostic', async () => {
  linuxCounters()
  const stop = await startHostCpuEstimate({ platform: 'linux' })
  expect(await stop()).toMatchObject({
    supported: true,
    pinnedCpus: '0',
    pinnedTaskMs: 20,
    ownTreeMs: 0,
    residualMs: 20,
  })
})

test('Linux counters disappearing after the start return an unsupported receipt', async () => {
  linuxCounters()
  const stop = await startHostCpuEstimate({ platform: 'linux' })
  vi.mocked(readFile).mockRejectedValue(new TypeError('counter unavailable'))
  expect(await stop()).toMatchObject({
    supported: false,
    platform: 'linux',
    reason: 'Linux CPU counters became unavailable',
  })
})
