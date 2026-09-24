import { onTestFinished, vi } from 'vitest'

import { log, type ClientLogLevel } from '@/lib/client-logging'

/**
 * Records the events one log level emits. A lazy event is resolved when it is
 * logged, as the logger does, so a summary that reads live state sees that moment.
 * Call it inside a test; the spy is restored when the test finishes.
 */
export function recordClientLog(level: ClientLogLevel) {
  const events: Record<string, unknown>[] = []
  const spy = vi.spyOn(log, level).mockImplementation((input: unknown) => {
    const event: unknown = typeof input === 'function' ? input() : input
    if (event === null || typeof event !== 'object') return
    events.push({ ...event })
  })
  onTestFinished(() => spy.mockRestore())

  return {
    events: (action: string) => events.filter((event) => event.action === action),
  }
}
