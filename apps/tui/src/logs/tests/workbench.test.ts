import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { test, expect } from '../../../test/fixtures'
import { createLogsWorkbench } from '@/logs/state/workbench'

test('reads real JSONL history and tails new events without duplicating the snapshot', async ({
  server,
  client,
}) => {
  await mkdir(`${server.root}/logs`)
  const timestamp = new Date().toISOString()
  const path = `${server.root}/logs/${timestamp.slice(0, 10)}.jsonl`
  await writeFile(
    path,
    JSON.stringify({
      timestamp,
      level: 'info',
      source: 'be',
      action: 'fixture.initial',
      requestId: 'initial',
    }) + '\n',
  )
  const store = createLogsWorkbench(client)
  try {
    await store.refresh()
    expect(store.getSnapshot().kind).toBe('ready')
    expect(store.getSnapshot().result.events.map((event) => event.action)).toEqual([
      'fixture.initial',
    ])
    await appendFile(
      path,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        source: 'tui',
        action: 'fixture.live',
        requestId: 'live',
      }) + '\n',
    )
    await expect
      .poll(() => store.getSnapshot().result.events.map((event) => event.action), { timeout: 5000 })
      .toContain('fixture.live')
    expect(store.getSnapshot().result.events).toHaveLength(2)
    expect(store.getSnapshot().summary?.errorCount).toBe(1)
    const event = store.getSnapshot().result.events.find((event) => event.action === 'fixture.live')
    expect(event).toBeDefined()
    if (event)
      expect(store.getSnapshot().result.detailsById[event.id]?.rawJson.requestId).toBe('live')
    await store.refresh({ search: 'no-such-event' }, true)
    expect(store.getSnapshot()).toMatchObject({
      kind: 'ready',
      live: false,
      result: { events: [] },
    })
  } finally {
    store.dispose()
  }
})
