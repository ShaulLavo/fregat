import { afterEach, describe, expect, it, vi } from 'vitest'

import { type Client, getClient, setClient } from '@/lib/client'
import * as api from '@/features/logs/utils/api'

// Eden can hand back live `Date` objects for timestamp fields; the api layer must
// normalize them to ISO strings before valibot validation. A real server returns
// JSON strings and never exercises that branch, so we inject a crafted response
// through the real client seam (`setClient`) — no `mock.module`.
let previousClient: Client | undefined

function clientWith(overrides: unknown) {
  previousClient ??= getClient()
  setClient(overrides as unknown as Client)
}

// Restore whatever was installed before, never a fixed default: the dom project
// hands every file an in-process client, and a reset-to-production would swap a
// real server for a socket halfway through a file.
afterEach(() => {
  if (previousClient) setClient(previousClient)
  previousClient = undefined
})

describe('logs api', () => {
  it('normalizes Eden Date values before validating dashboard responses', async () => {
    const summaryGet = vi.fn().mockResolvedValueOnce({
      data: {
        actions: [],
        areas: [],
        durationP95Ms: null,
        errorCount: 0,
        firstTimestamp: new Date('2026-05-25T10:00:00.000Z'),
        generatedAt: new Date('2026-05-25T10:01:00.000Z'),
        lastTimestamp: new Date('2026-05-25T10:00:30.000Z'),
        levels: [],
        slowCount: 0,
        sources: [],
        timeline: [
          {
            end: new Date('2026-05-25T10:01:00.000Z'),
            error: 0,
            slow: 0,
            start: new Date('2026-05-25T10:00:00.000Z'),
            total: 1,
            warn: 0,
          },
        ],
        total: 1,
        warnCount: 0,
      },
    })
    clientWith({ _log: { dashboard: { summary: { get: summaryGet } } } })

    const result = await api.fetchLogSummary(
      {
        since: '2026-05-25T10:00:00.000Z',
        slowMs: 500,
      },
      undefined,
      getClient(),
    )

    expect(result.generatedAt).toBe('2026-05-25T10:01:00.000Z')
    expect(result.timeline[0].start).toBe('2026-05-25T10:00:00.000Z')
    expect(summaryGet).toHaveBeenCalledWith({
      fetch: { signal: undefined },
      query: {
        areas: undefined,
        levels: undefined,
        search: undefined,
        since: '2026-05-25T10:00:00.000Z',
        slowMs: 500,
        sources: undefined,
        until: undefined,
      },
    })
  })

  it('normalizes Eden Date values in event result timestamps', async () => {
    const event = {
      action: 'git.status',
      area: 'git',
      durationMs: null,
      environment: null,
      errorCode: null,
      errorMessage: null,
      errorName: null,
      id: 'event-1',
      level: 'info',
      message: null,
      method: null,
      operation: null,
      outcome: null,
      path: null,
      requestId: null,
      service: null,
      source: 'client',
      status: null,
      sessionId: null,
      timestamp: new Date('2026-05-25T10:02:00.000Z'),
    } as const

    const eventsGet = vi.fn().mockResolvedValueOnce({
      data: {
        detailsById: {
          'event-1': {
            event,
            rawJson: { action: 'git.status' },
          },
        },
        events: [event],
        nextCursor: null,
        total: 1,
      },
    })
    clientWith({ _log: { dashboard: { events: { get: eventsGet } } } })

    const result = await api.fetchLogEvents({}, undefined, getClient())

    expect(result.events[0].timestamp).toBe('2026-05-25T10:02:00.000Z')
    expect(result.detailsById['event-1']?.event.timestamp).toBe('2026-05-25T10:02:00.000Z')
  })
})
