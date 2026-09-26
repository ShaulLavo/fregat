import { expect, test, vi } from 'vitest'
import { ClientPresence } from '../client-presence'

test('expires focus from a suspended socket and accepts a fresh report', () => {
  vi.useFakeTimers()
  try {
    const presence = new ClientPresence()
    const socket = {}
    presence.report(socket, true)
    expect(presence.focusedCount).toBe(1)
    vi.advanceTimersByTime(45_001)
    expect(presence.focusedCount).toBe(0)
    presence.report(socket, true)
    vi.advanceTimersByTime(30_000)
    presence.report(socket, true)
    vi.advanceTimersByTime(30_000)
    expect(presence.focusedCount).toBe(1)
    presence.forget(socket)
    expect(presence.focusedCount).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
