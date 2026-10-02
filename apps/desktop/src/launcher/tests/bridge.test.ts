import { expect, test } from 'vitest'
import { chromiumBridge } from '../chromium'
import { parsePickRequest } from '../shell-bridge'
import type { PlatformBridge } from '../../shared/bridge'
import { isMacDesktop } from '../../../../web/src/lib/platform/bridge'

function documentFixture(origin: string) {
  const requests: Record<string, unknown>[] = []
  const global: Record<string, unknown> = {
    platformShellCall: (payload: string) => requests.push(JSON.parse(payload)),
  }
  const window = { top: undefined as unknown }
  window.top = window
  const timers: (() => void)[] = []
  const loads: (() => void)[] = []
  const evaluate = new Function(
    'globalThis',
    'window',
    'location',
    'document',
    'addEventListener',
    'setTimeout',
    'requestAnimationFrame',
    chromiumBridge('http://localhost:123/'),
  )
  evaluate(
    global,
    window,
    { origin },
    { readyState: 'complete' },
    (_: string, callback: () => void) => loads.push(callback),
    (callback: () => void) => timers.push(callback),
    () => {},
  )
  return { global, timers, requests }
}

test('bridge executes in current document only on app origin and exposes its native picker', () => {
  expect(documentFixture('http://localhost:123').global.platformBridge).toEqual({
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
    capabilities: { displayCapture: true },
    pickEntry: expect.any(Function),
  })
  const foreign = documentFixture('http://external.test')
  expect(foreign.global.platformBridge).toBeUndefined()
  expect(foreign.requests).toEqual([])
})
test('Mac desktop layout reserves traffic lights only for an overlay titlebar', () => {
  const previous = globalThis.window
  const window = {} as Window & typeof globalThis
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  try {
    window.platformBridge = {
      backdrop: 'app',
      platform: 'darwin',
      colorScheme: null,
      titlebar: 'native',
    }
    expect(isMacDesktop()).toBe(false)
    window.platformBridge.titlebar = 'overlay'
    expect(isMacDesktop()).toBe(true)
    window.platformBridge.platform = 'linux'
    expect(isMacDesktop()).toBe(false)
  } finally {
    if (previous)
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('picker replies match their document and only one dialog opens per document', async () => {
  const { global, requests } = documentFixture('http://localhost:123')
  const bridge = global.platformBridge as PlatformBridge
  const pending = bridge.pickEntry!({ mode: 'folder' })
  await expect(bridge.pickEntry!({ mode: 'file' })).rejects.toThrow('already open')
  const request = requests[0]!
  expect(parsePickRequest(request, 'http://localhost:123')).toMatchObject({
    options: { mode: 'folder' },
  })
  expect(parsePickRequest(request, 'http://foreign.test')).toBeUndefined()
  expect(
    parsePickRequest({ ...request, documentId: 'invalid' }, 'http://localhost:123'),
  ).toBeUndefined()
  const reply = global.__platformShellReply as (response: unknown) => void
  let settled = false
  void pending.then(() => {
    settled = true
  })
  reply({ ...request, documentId: crypto.randomUUID(), paths: ['/wrong-document'] })
  await Promise.resolve()
  expect(settled).toBe(false)
  reply({ ...request, paths: ['/fixture/資料'] })
  await expect(pending).resolves.toEqual(['/fixture/資料'])
})
