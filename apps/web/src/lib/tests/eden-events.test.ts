import { describe, expect, it } from 'vitest'

import { normalizeEdenDates } from '@workspace/client-core/transport/normalize-dates'
import { parseEdenSseStream } from '@workspace/client-core/transport/eden'

describe('Eden SSE events', () => {
  it('normalizes Date values to wire-compatible ISO strings', () => {
    const createdAt = new Date('2026-05-24T20:00:00.000Z')

    expect(
      normalizeEdenDates({
        createdAt,
        nested: [{ updatedAt: createdAt }],
      }),
    ).toEqual({
      createdAt: '2026-05-24T20:00:00.000Z',
      nested: [{ updatedAt: '2026-05-24T20:00:00.000Z' }],
    })
  })

  it('normalizes parsed stream data', async () => {
    const events = []

    for await (const event of parseEdenSseStream(
      asyncItems([
        {
          data: { updatedAt: new Date('2026-05-24T20:00:00.000Z') },
          event: 'snapshot',
        },
      ]),
    )) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        data: { updatedAt: '2026-05-24T20:00:00.000Z' },
        event: 'snapshot',
      },
    ])
  })
})

async function* asyncItems<T>(items: T[]) {
  for (const item of items) {
    yield item
  }
}
