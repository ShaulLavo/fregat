import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import { expect, test, vi } from 'vitest'
import { startProductionCdp } from './production-cdp'

type TraceMode = 'complete' | 'data-loss' | 'missing-completion' | 'pending-end' | 'rejected-end'
const event = { name: 'fixture-event', ts: 1, ph: 'i', pid: 1, tid: 1 }
class FixtureSession extends EventEmitter {
  readonly commands: string[] = []
  readonly mode: TraceMode
  constructor(mode: TraceMode) {
    super()
    this.mode = mode
  }
  async send(method: string) {
    this.commands.push(method)
    if (method !== 'Tracing.end') return {}
    this.emit('Tracing.dataCollected', { value: [event] })
    if (this.mode === 'pending-end') return new Promise(() => {})
    if (this.mode === 'rejected-end') throw new TypeError('CDP end failed')
    if (this.mode === 'missing-completion') return {}
    this.emit('Tracing.tracingComplete', { dataLossOccurred: this.mode === 'data-loss' })
    return {}
  }
  async detach() {
    this.commands.push('detach')
  }
}

function fixturePage(session: FixtureSession) {
  // The fixture implements only the external CDP boundary exercised by the collector.
  return {
    context: () => ({ newCDPSession: async () => session }),
    workers: () => [],
  } as unknown as Page
}

test.each(['complete', 'data-loss', 'rejected-end'] as const)(
  'trace finalization retains raw bytes and explicit %s state exactly once',
  async (mode) => {
    const output = await mkdtemp(path.join(tmpdir(), 'production-trace-'))
    const session = new FixtureSession(mode)
    const capture = await startProductionCdp(fixturePage(session))
    try {
      const finished = capture.finishTrace(output)
      if (mode === 'complete') await expect(finished).resolves.toBeDefined()
      else
        await expect(finished).rejects.toThrow(
          mode === 'data-loss' ? 'lost events' : 'CDP end failed',
        )
      const raw = JSON.parse(await readFile(path.join(output, 'production-trace.json'), 'utf8'))
      expect(raw.traceEvents).toEqual([event])
      expect(raw.capture.status).toBe(mode === 'rejected-end' ? 'incomplete' : mode)
      expect(raw.capture.outcome).toBe(mode === 'complete' ? 'completed' : 'failed')
      const summary = JSON.parse(
        await readFile(path.join(output, 'production-trace-summary.json'), 'utf8'),
      )
      expect(summary.capture).toEqual(raw.capture)
      await capture.finishTrace(output).catch(() => undefined)
      expect(session.commands.filter((command) => command === 'Tracing.end')).toHaveLength(1)
      expect(session.listenerCount('Tracing.dataCollected')).toBe(0)
      expect(session.listenerCount('Tracing.tracingComplete')).toBe(0)
    } finally {
      await capture.close()
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.each(['pending-end', 'missing-completion'] as const)(
  'trace %s is bounded and preserves available events',
  async (mode) => {
    const output = await mkdtemp(path.join(tmpdir(), 'production-trace-timeout-'))
    const session = new FixtureSession(mode)
    const capture = await startProductionCdp(fixturePage(session))
    vi.useFakeTimers()
    try {
      const finished = capture.finishTrace(output)
      const rejected = expect(finished).rejects.toThrow('Chrome trace completion')
      await vi.advanceTimersByTimeAsync(15_001)
      await rejected
      const raw = JSON.parse(await readFile(path.join(output, 'production-trace.json'), 'utf8'))
      expect(raw.traceEvents).toEqual([event])
      expect(raw.capture.status).toBe('incomplete')
    } finally {
      vi.useRealTimers()
      await capture.close()
      await rm(output, { recursive: true, force: true })
    }
  },
)
