import { expect, test } from 'vitest'
import { createEnvironmentsStore, selectServerConnection } from '../state/store'

test('separate clients own their active origin and slow-request bookkeeping', () => {
  const primaryOrigin = 'http://localhost:3001'
  const first = createEnvironmentsStore({ primaryOrigin })
  const second = createEnvironmentsStore({ primaryOrigin })

  first.getState().activate('http://localhost:3002')
  expect(second.getState().activeOrigin).toBe(primaryOrigin)

  first.getState().markSlowRequest(primaryOrigin, 'same-request-id')
  second.getState().markSlowRequest(primaryOrigin, 'same-request-id')
  expect(selectServerConnection(first.getState(), primaryOrigin).slowRequestCount).toBe(1)
  expect(selectServerConnection(second.getState(), primaryOrigin).slowRequestCount).toBe(1)

  first.getState().resetConnections()
  expect(selectServerConnection(second.getState(), primaryOrigin).slowRequestCount).toBe(1)
  second.getState().clearSlowRequest(primaryOrigin, 'same-request-id')
  expect(selectServerConnection(second.getState(), primaryOrigin).slowRequestCount).toBe(0)
})

test('a connection reset keeps the staged update the server last pushed', () => {
  const primaryOrigin = 'http://localhost:3001'
  const store = createEnvironmentsStore({ primaryOrigin })
  const update = { phase: 'restarting', pending: null, liveCheck: null } as const

  store.getState().recordServerUpdate(`${primaryOrigin}/`, update)
  store.getState().resetConnections(primaryOrigin)

  expect(store.getState().updateByOrigin[primaryOrigin]).toEqual(update)
})
