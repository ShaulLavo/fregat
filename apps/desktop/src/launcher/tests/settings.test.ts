import { test, expect } from 'vitest'
import { readSettings } from '../settings'
import { nativeBudget } from '../native-helper'
import { startupBudget } from '../startup'

for (const status of [403, 503]) {
  test(`settings HTTP ${status} warns once and uses defaults`, async () => {
    const warnings: Record<string, unknown>[] = []
    const settings = await readSettings('http://localhost:3301', 'http://localhost:3301/', {
      signal: new AbortController().signal,
      fetcher: async () => new Response('private response body', { status }),
      onWarning: (context) => warnings.push(context),
    })
    expect(settings).toEqual({
      browser: 'auto',
      transparency: 'compositor',
      startup: startupBudget(),
      native: nativeBudget(),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ status })
    expect(JSON.stringify(warnings)).not.toContain('private response body')
  })
}

for (const body of ['{}', 'invalid json']) {
  test(`invalid settings response ${body} warns with HTTP status`, async () => {
    const warnings: Record<string, unknown>[] = []
    const settings = await readSettings('http://localhost:3301', 'http://localhost:3301/', {
      signal: new AbortController().signal,
      fetcher: async () => new Response(body),
      onWarning: (context) => warnings.push(context),
    })
    expect(settings.browser).toBe('auto')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ status: 200 })
  })
}

test('unreachable settings warn once and use defaults', async () => {
  const warnings: Record<string, unknown>[] = []
  const settings = await readSettings('http://localhost:3301', 'http://localhost:3301/', {
    signal: new AbortController().signal,
    fetcher: async () => Promise.reject(new DOMException('Fetch failed', 'NetworkError')),
    onWarning: (context) => warnings.push(context),
  })
  expect(settings.browser).toBe('auto')
  expect(settings.transparency).toBe('compositor')
  expect(warnings).toHaveLength(1)
})

test('settings request timeout warns and keeps the launcher running with defaults', async () => {
  const controller = new AbortController()
  const warnings: Record<string, unknown>[] = []
  const settings = await readSettings('http://localhost:3301', 'http://localhost:3301/', {
    signal: controller.signal,
    fetcher: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    onWarning: (context) => warnings.push(context),
  })
  expect(settings.browser).toBe('auto')
  expect(controller.signal.aborted).toBe(false)
  expect(warnings).toEqual([{ status: undefined, reason: 'timeout' }])
})

test('launcher cancellation propagates without a settings fallback warning', async () => {
  const controller = new AbortController()
  const warnings: Record<string, unknown>[] = []
  controller.abort()
  await expect(
    readSettings('http://localhost:3301', 'http://localhost:3301/', {
      signal: controller.signal,
      fetcher: async (_input, init) => {
        init?.signal?.throwIfAborted()
        return Response.json({ values: {} })
      },
      onWarning: (context) => warnings.push(context),
    }),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(warnings).toHaveLength(0)
})
