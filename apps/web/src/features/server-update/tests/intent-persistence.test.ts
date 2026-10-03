import { expect, test } from '../../../../test/fixtures'
import { TEST_SESSION_ID } from '../../../../test/factories/chat'
import { createUpdateIntentStore } from '@/features/server-update/state/intent'

function windowStorage() {
  const records = new Map<string, string>()
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value)
    },
    removeItem: (key: string) => {
      records.delete(key)
    },
    records,
  }
}

const target = { release: 'next-release', stagedAt: '2026-10-02T18:00:00.000Z' }
const laterTarget = { ...target, stagedAt: '2026-10-02T18:01:00.000Z' }
const busy = [
  {
    sessionId: TEST_SESSION_ID,
    title: 'Private task',
    projectTitle: 'Private project',
    state: 'running',
  },
] as const

// Each storage represents one browser window's sessionStorage across document lifetimes.
test('restores only the initiating window and the exact waiting staging operation', () => {
  const initiating = windowStorage()
  const other = windowStorage()
  const first = createUpdateIntentStore({ storage: initiating })
  first.getState().setIntent({ kind: 'waiting', target: laterTarget, busy, gateReadAt: 500 })

  expect(createUpdateIntentStore({ storage: other }).getState().intent).toEqual({ kind: 'idle' })
  expect(createUpdateIntentStore({ storage: initiating }).getState().intent).toEqual({
    kind: 'waiting',
    target: laterTarget,
    busy: [],
    gateReadAt: 0,
  })
  expect([...initiating.records.values()].join('')).not.toContain(TEST_SESSION_ID)
  expect([...initiating.records.values()].join('')).not.toContain('Private task')
})

test('restores restart observation and its original deadline without interruption consent', () => {
  const storage = windowStorage()
  let time = 1000
  const options = { storage, now: () => time, restartTimeoutMs: () => 120_000 }
  const first = createUpdateIntentStore(options)
  first.getState().setIntent({
    kind: 'restarting',
    target,
    confirmed: false,
    instance: 'old-instance',
    fromRelease: 'old-release',
  })
  time = 2000
  first.getState().setIntent({
    kind: 'restarting',
    target,
    confirmed: true,
    instance: 'old-instance',
    fromRelease: 'old-release',
  })

  expect(createUpdateIntentStore(options).getState().intent).toEqual({
    kind: 'restarting',
    target,
    confirmed: false,
    instance: 'old-instance',
    fromRelease: 'old-release',
    startedAt: 1000,
  })
  expect([...storage.records.values()].join('')).not.toContain('confirmed')
})

test('expires an abandoned restart on document recreation and clears its record', () => {
  const storage = windowStorage()
  const first = createUpdateIntentStore({ storage, now: () => 1000, restartTimeoutMs: () => 2000 })
  first.getState().setIntent({
    kind: 'restarting',
    target,
    confirmed: true,
    instance: null,
    fromRelease: 'old-release',
  })
  expect(
    createUpdateIntentStore({ storage, now: () => 3000, restartTimeoutMs: () => 2000 }).getState()
      .intent,
  ).toEqual({ kind: 'failed', target, reason: 'timeout' })
  expect(storage.records.size).toBe(0)
  expect(createUpdateIntentStore({ storage }).getState().intent).toEqual({ kind: 'idle' })
})

test('waiting remains unbounded and page-only reload retains the exact target', () => {
  const storage = windowStorage()
  const first = createUpdateIntentStore({ storage, now: () => 1000 })
  first.getState().setIntent({ kind: 'waiting', target, busy, gateReadAt: 50 })
  expect(createUpdateIntentStore({ storage, now: () => 1e12 }).getState().intent.kind).toBe(
    'waiting',
  )
  const pageTarget = { release: 'page-release', stagedAt: null }
  first.getState().setIntent({ kind: 'reload', target: pageTarget })
  expect(createUpdateIntentStore({ storage }).getState().intent).toEqual({
    kind: 'reload',
    target: pageTarget,
  })
})

test('completion, supersession, failure and a new confirmation remove durable intent', () => {
  const storage = windowStorage()
  const store = createUpdateIntentStore({ storage })
  const cleared = [
    { kind: 'idle' },
    { kind: 'failed', target },
    { kind: 'confirm', target: laterTarget, busy },
  ] as const
  for (const intent of cleared) {
    store.getState().setIntent({ kind: 'waiting', target, busy, gateReadAt: 0 })
    store.getState().setIntent(intent)
    expect(storage.records.size).toBe(0)
    expect(createUpdateIntentStore({ storage }).getState().intent).toEqual({ kind: 'idle' })
  }
})

test('a superseding restart starts a fresh deadline for its exact target', () => {
  const storage = windowStorage()
  let time = 1000
  const store = createUpdateIntentStore({ storage, now: () => time })
  store
    .getState()
    .setIntent({ kind: 'restarting', target, confirmed: false, instance: null, fromRelease: null })
  time = 2000
  store.getState().setIntent({
    kind: 'restarting',
    target: laterTarget,
    confirmed: false,
    instance: null,
    fromRelease: null,
  })
  expect(store.getState().intent).toMatchObject({ target: laterTarget, startedAt: 2000 })
})

test('malformed durable state fails closed and storage denial leaves the live store usable', () => {
  const storage = windowStorage()
  const store = createUpdateIntentStore({ storage })
  store.getState().setIntent({ kind: 'reload', target })
  const key = [...storage.records.keys()][0]!
  storage.setItem(key, '{broken')
  expect(createUpdateIntentStore({ storage }).getState().intent).toEqual({ kind: 'idle' })
  expect(storage.records.size).toBe(0)
  const denied = {
    getItem: () => {
      throw new DOMException('Denied', 'SecurityError')
    },
    setItem: () => {
      throw new DOMException('Denied', 'SecurityError')
    },
    removeItem: () => {
      throw new DOMException('Denied', 'SecurityError')
    },
  }
  const live = createUpdateIntentStore({ storage: denied })
  live.getState().setIntent({ kind: 'reload', target })
  expect(live.getState().intent).toEqual({ kind: 'reload', target })
})
