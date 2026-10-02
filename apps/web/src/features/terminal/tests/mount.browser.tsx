import { vi } from 'vitest'
import { expect, test } from '../../../../test/fixtures'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { getClient, primaryServerOrigin } from '@/lib/client'
import { mountTerminal } from '@/features/terminal/state/mount'
import { terminalCheckoutQueryOptions } from '@/features/terminal/state/register-checkout'
import { terminalQueryKeys } from '@/features/terminal/utils/query-keys'

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
