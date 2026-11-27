import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { TerminalView } from '@shaulavo/workbench-terminal'
import { isCancelledError } from '@tanstack/query-core'
import { GhosttyRuntime, type Terminal } from 'ghostty-webgpu'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { vi } from 'vitest'

import {
  createFregatRuntimeLoader,
  createFregatTerminalAdapter,
} from '@/features/terminal/state/fregat-adapter'
import { terminalCheckoutQueryOptions } from '@/features/terminal/state/register-checkout'
import { initializeGhostty } from '@/features/terminal/state/runtime'
import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'
import { getClient, primaryServerOrigin } from '@/lib/client'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

import { expect, test } from '../../../../test/fixtures'

function mountFregatTerminalView(options: {
  readonly host: HTMLDivElement
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly screenReader?: boolean
  readonly onReady: (terminal: Terminal) => void
  readonly onFailed: (message: string) => void
}) {
  const adapter = createFregatTerminalAdapter({
    origin: primaryServerOrigin(),
    client: getClient(),
    rootPath: '.',
    signal: options.signal,
    getSavedScroll: () => null,
  })
  const loadRuntime = createFregatRuntimeLoader(primaryServerOrigin(), options.signal)
  const root = createRoot(options.host)
  flushSync(() => {
    root.render(
      <TerminalView
        adapter={adapter}
        sessionId={options.sessionId}
        loadRuntime={loadRuntime}
        scrollbackLimit={100}
        screenReader={options.screenReader ?? false}
        disableContextMenu
        onTerminalReady={options.onReady}
        onError={() =>
          options.onFailed(
            'Could not open the terminal. Close this terminal tab and open a new one.',
          )
        }
      />,
    )
  })
  return () => {
    root.unmount()
  }
}

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
    const unmount = mountFregatTerminalView({
      host,
      sessionId: `wasm-startup-${phase}`,
      signal: controller.signal,
      onReady,
      onFailed,
    })
    // Allow TerminalView's effect (waitForDocumentFonts -> loadRuntime) to attach to the in-flight query.
    await document.fonts.ready
    await Promise.resolve()
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
        await expect.poll(() => onFailed.mock.calls.length, { timeout: 5_000 }).toBe(1)
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
    const unmount = mountFregatTerminalView({
      host,
      sessionId: `cancelled-open-${earlyRestore}`,
      signal: controller.signal,
      onReady,
      onFailed,
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

test.each([undefined, false, true])(
  'the mounted terminal applies screen-reader setting %s and releases its mirror',
  { timeout: 20_000 },
  async (enabled) => {
    const initiallyEnabled = enabled ?? DEFAULT_SETTING_VALUES['terminal.integrated.screenReader']
    await primaryQueryClient().query(terminalCheckoutQueryOptions('.'))
    const host = document.createElement('div')
    host.className = 'h-96 w-96'
    document.body.append(host)
    const onReady = vi.fn()
    const onFailed = vi.fn()
    const controller = new AbortController()
    const unmount = mountFregatTerminalView({
      host,
      sessionId: 'screen-reader-mount',
      signal: controller.signal,
      screenReader: initiallyEnabled,
      onReady,
      onFailed,
    })
    try {
      await expect
        .poll(() => onReady.mock.calls.length + onFailed.mock.calls.length, { timeout: 10_000 })
        .toBe(1)
      expect(onFailed).not.toHaveBeenCalled()
      const terminal = onReady.mock.calls[0]![0] as Terminal
      // Stop PTY replay and shell output before this test owns the displayed text.
      controller.abort()
      expect(terminal.lifecycle).toBe('open')
      expect(Boolean(host.querySelector('[aria-label="Terminal screen"]'))).toBe(initiallyEnabled)
      expect(terminal.setAccessibilityEnabled(false)).toBe(initiallyEnabled)
      expect(host.querySelector('[aria-label="Terminal screen"]')).toBeNull()
      await terminal.write('\x1b[2J\x1b[Hscreen-reader output')
      await expect.poll(() => terminal.visibleLines().join('\n')).toContain('screen-reader output')
      expect(terminal.setAccessibilityEnabled(true)).toBe(true)
      const mirror = host.querySelector('[aria-label="Terminal screen"]')!
      expect(mirror.textContent).toContain('screen-reader output')
      await terminal.write(' refreshed')
      await expect.poll(() => mirror.textContent).toContain('screen-reader output refreshed')
      const terminalRoot = terminal.element!
      unmount()
      expect(terminal.lifecycle).toBe('disposed')
      expect(terminal.element).toBeUndefined()
      expect(mirror.isConnected).toBe(false)
      expect(terminalRoot.isConnected).toBe(false)
      expect(host.children).toHaveLength(0)
    } finally {
      controller.abort()
      unmount()
      host.remove()
    }
  },
)
