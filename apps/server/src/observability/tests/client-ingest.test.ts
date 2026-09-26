import { describe, expect, test, vi } from 'vitest'

const emitted: { fields: Record<string, unknown>; level: string }[] = []

vi.mock('evlog', () => ({
  log: {
    debug: (fields: Record<string, unknown>) => emitted.push({ fields, level: 'debug' }),
    error: (fields: Record<string, unknown>) => emitted.push({ fields, level: 'error' }),
    info: (fields: Record<string, unknown>) => emitted.push({ fields, level: 'info' }),
    warn: (fields: Record<string, unknown>) => emitted.push({ fields, level: 'warn' }),
  },
}))

import { recordClientLog } from '../client-ingest'

function ingestRequest(query = '') {
  return new Request(`http://localhost:3001/_log/ingest${query}`, { method: 'POST' })
}

function clientPayload(eventId?: string) {
  return {
    action: 'app.bootstrap',
    area: 'app',
    eventId,
    level: 'info',
    timestamp: new Date().toISOString(),
  }
}

describe('recordClientLog', () => {
  test('stamps client.instanceId from the ingest URL instance param', () => {
    emitted.length = 0
    const result = recordClientLog(clientPayload(), ingestRequest('?instance=tab-a'))

    expect(result).toEqual({ ok: true })
    expect(emitted[0]?.fields.client).toMatchObject({ instanceId: 'tab-a' })
  })

  test('omits instanceId when the param is missing', () => {
    emitted.length = 0
    recordClientLog(clientPayload(), ingestRequest())

    expect(emitted[0]?.fields.client).not.toHaveProperty('instanceId')
  })

  test('caps oversized instance ids', () => {
    emitted.length = 0
    recordClientLog(clientPayload(), ingestRequest(`?instance=${'x'.repeat(200)}`))

    const client = emitted[0]?.fields.client as { instanceId: string }
    expect(client.instanceId).toHaveLength(64)
  })

  test('deduplicates retries by client instance and event id', () => {
    emitted.length = 0
    const payload = clientPayload('retry-1')

    recordClientLog(payload, ingestRequest('?instance=tab-dedupe'))
    recordClientLog(payload, ingestRequest('?instance=tab-dedupe'))

    expect(emitted).toHaveLength(1)
  })

  test('preserves the same event id from another client instance', () => {
    emitted.length = 0
    const payload = clientPayload('shared-event')

    recordClientLog(payload, ingestRequest('?instance=tab-one'))
    recordClientLog(payload, ingestRequest('?instance=tab-two'))

    expect(emitted).toHaveLength(2)
  })

  test('bounds untrusted payloads and redacts stacks and credentials', () => {
    emitted.length = 0
    const wide = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`k${index}`, index]))
    recordClientLog(
      {
        ...clientPayload(),
        error: { message: 'failed', name: 'Error', stack: 'Error: failed\n    at private.ts:1' },
        items: Array.from({ length: 30 }, (_, index) => index),
        message: 'm'.repeat(2500),
        nested: { a: { b: { c: { d: { e: { f: 'deep' } } } } } },
        request: { headers: { authorization: 'Bearer secret' }, token: 'secret' },
        wide,
      },
      ingestRequest(),
    )

    const fields = emitted[0]?.fields
    expect(fields).toMatchObject({
      error: { message: 'failed', name: 'Error', stack: '[redacted]' },
      items: Array.from({ length: 25 }, (_, index) => index),
      message: 'm'.repeat(2000),
      nested: { a: { b: { c: { d: { e: '[truncated]' } } } } },
      request: { headers: { authorization: '[redacted]' }, token: '[redacted]' },
    })
    expect(Object.keys(fields?.wide as object)).toHaveLength(50)
  })

  test('bounds dedupe retention and admits an evicted event again', () => {
    emitted.length = 0
    for (let index = 0; index <= 1_024; index += 1) {
      recordClientLog(clientPayload(`bounded-${index}`), ingestRequest('?instance=tab-bounded'))
    }

    recordClientLog(clientPayload('bounded-0'), ingestRequest('?instance=tab-bounded'))

    expect(emitted).toHaveLength(1_026)
  })
})
