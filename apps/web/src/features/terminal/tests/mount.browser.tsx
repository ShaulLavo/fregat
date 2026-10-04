import { vi } from 'vitest'
import { isCancelledError } from '@tanstack/query-core'
import { GhosttyRuntime } from 'ghostty-webgpu'
import { initializeGhostty } from '@/features/terminal/state/runtime'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import { expect, test } from '../../../../test/fixtures'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { getClient, primaryServerOrigin } from '@/lib/client'
import { mountTerminal } from '@/features/terminal/state/mount'
import { terminalCheckoutQueryOptions } from '@/features/terminal/state/register-checkout'
import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'

test.each([
  'active',
  'departed',
  'beforeunload',
  'prevented-departure',
  'early-restore',
  'late-restore',
  'unmounted',
] as const)(
  'a startup WASM fetch failure belongs to its page lifecycle, %s',
  { timeout: 20_000 },
  async (phase) => {
    const queryKey = terminalQueryKeys.runtime
    resourceQueryClient.getQueryData<GhosttyRuntime>(queryKey)?.dispose()
    resourceQueryClient.removeQueries({ queryKey })
    await primaryQueryClient().query(terminalCheckoutQueryOptions('.'))
    const requested = Promise.withResolvers<void>()
    const response = Promise.withResolvers<Response>()
    const fetchBytes = globalThis.fetch
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.endsWith('/bridge.wasm')) return fetchBytes(input, init)
      requested.resolve()
      return response.promise
    })
    const opening = initializeGhostty().catch((error: unknown) => error)
    await requested.promise
    const host = document.createElement('div')
    host.className = 'h-96 w-96'
    document.body.append(host)
    const onFailed = vi.fn()
    const onReady = vi.fn()
    const controller = new AbortController()
    const unmount = mountTerminal({
      origin: primaryServerOrigin(),
      client: getClient(),
      signal: controller.signal,
      host,
      rootPath: '.',
      scrollback: 100,
      sessionId: `wasm-startup-${phase}`,
      onConnectedChange: vi.fn(),
      getSavedScroll: () => null,
      onCapture: vi.fn(),
      onExit: vi.fn(),
      onFailed,
      onProcessChange: vi.fn(),
      onReady,
      onScrollbackLengthChange: vi.fn(),
      onTitleChange: vi.fn(),
    })
    try {
      if (phase === 'unmounted') unmount()
      if (phase === 'beforeunload') window.dispatchEvent(new Event('beforeunload'))
      if (phase === 'prevented-departure') {
        const departure = new Event('beforeunload', { cancelable: true })
        departure.preventDefault()
        window.dispatchEvent(departure)
      }
      if (phase === 'departed' || phase === 'early-restore' || phase === 'late-restore')
        window.dispatchEvent(new Event('pagehide'))
      const cause = new TypeError('Failed to fetch')
      fetch.mockRestore()
      response.reject(cause)
      if (phase === 'early-restore') window.dispatchEvent(new Event('pageshow'))
      const error = await opening
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (phase === 'active' || phase === 'prevented-departure') {
        expect(onFailed).toHaveBeenCalledOnce()
        expect(onFailed).toHaveBeenCalledWith(
          'Could not open the terminal. Close this terminal tab and open a new one.',
        )
        expect(error).toMatchObject({ name: 'GhosttyError', operation: 'wasm.fetch', cause })
        expect(resourceQueryClient.getQueryState(queryKey)?.status).toBe('error')
        return
      }
      expect(onFailed).not.toHaveBeenCalled()
      if (phase !== 'unmounted') expect(isCancelledError(error)).toBe(true)
      if (phase === 'late-restore') window.dispatchEvent(new Event('pageshow'))
      if (phase === 'early-restore' || phase === 'late-restore') {
        await expect.poll(() => onReady.mock.calls.length, { timeout: 10_000 }).toBe(1)
        expect(host.querySelector('canvas')).not.toBeNull()
        expect(onFailed).not.toHaveBeenCalled()
        const runtime = resourceQueryClient.getQueryData<GhosttyRuntime>(queryKey)
        window.dispatchEvent(new Event('pagehide'))
        window.dispatchEvent(new Event('pageshow'))
        expect(await initializeGhostty()).toBe(runtime)
        expect(onReady).toHaveBeenCalledOnce()
        return
      }
      expect(onReady).not.toHaveBeenCalled()
    } finally {
      controller.abort()
      unmount()
      host.remove()
      fetch.mockRestore()
      resourceQueryClient.getQueryData<GhosttyRuntime>(queryKey)?.dispose()
      resourceQueryClient.removeQueries({ queryKey })
      window.dispatchEvent(new Event('pageshow'))
    }
  },
)

test.each([false, true])(
  'a cancelled terminal open recovers on page restoration, early restore %s',
  { timeout: 20_000 },
  async (earlyRestore) => {
    const client = primaryQueryClient()
    const queryKey = terminalQueryKeys.checkout('.')
    client.removeQueries({ queryKey })
    const pending = client.query({
      ...terminalCheckoutQueryOptions('.'),
      queryFn: ({ signal }) => {
        signal.throwIfAborted()
        return new Promise<never>(() => undefined)
      },
    })
    const settled = pending.catch(() => undefined)
    const host = document.createElement('div')
    host.className = 'h-96 w-96'
    document.body.append(host)
    const onReady = vi.fn()
    const onFailed = vi.fn()
    const controller = new AbortController()
    const unmount = mountTerminal({
      origin: primaryServerOrigin(),
      client: getClient(),
      signal: controller.signal,
      host,
      rootPath: '.',
      scrollback: 100,
      sessionId: `cancelled-open-${earlyRestore}`,
      onConnectedChange: vi.fn(),
      getSavedScroll: () => null,
      onCapture: vi.fn(),
      onExit: vi.fn(),
      onFailed,
      onProcessChange: vi.fn(),
      onReady,
      onScrollbackLengthChange: vi.fn(),
      onTitleChange: vi.fn(),
    })
    try {
      window.dispatchEvent(new Event('pagehide'))
      if (earlyRestore) window.dispatchEvent(new Event('pageshow'))
      await settled
      if (!earlyRestore) {
        await Promise.resolve()
        window.dispatchEvent(new Event('pageshow'))
      }

      await expect
        .poll(() => onReady.mock.calls.length + onFailed.mock.calls.length, { timeout: 10_000 })
        .toBe(1)
      expect(onFailed.mock.calls).toEqual([])
      expect(onReady).toHaveBeenCalledOnce()
      expect(host.querySelector('canvas')).not.toBeNull()
      expect(onFailed).not.toHaveBeenCalled()
      window.dispatchEvent(new Event('pageshow'))
      expect(onReady).toHaveBeenCalledOnce()
    } finally {
      controller.abort()
      unmount()
      host.remove()
      client.removeQueries({ queryKey })
      window.dispatchEvent(new Event('pageshow'))
    }
  },
)
