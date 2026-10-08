import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import {
  capturedTerminal,
  installCaptureTerminalNamespace,
  killCaptureTerminal,
} from './product-terminal'
import { selectors } from './selectors'

export async function observeTerminalContinuity(page: Page) {
  const prefix = `desktop-proof-${crypto.randomUUID()}-`
  const terminals = new Map<
    string,
    { socketUrl: string; killUrl: string; worktreeId: string; terminalId: string }
  >()
  let output = ''
  let readyCount = 0
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (!url.pathname.endsWith('/terminal')) return
    const terminal = capturedTerminal(socket.url(), prefix)
    ok(terminal, 'Continuity proof can use only its isolated shells')
    terminals.set(socket.url(), terminal)
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') {
        output += payload.toString('utf8')
        return
      }
      if (JSON.parse(payload).type === 'ready') readyCount++
    })
  })
  await installCaptureTerminalNamespace(page, prefix)
  await page.reload()
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline && !condition()) await page.waitForTimeout(50)
    ok(condition(), 'The existing shared shell must answer with its retained variable')
  }
  const command = async (label: string, initialize = false) => {
    await selectors.terminalSurface(page).first().waitFor()
    await selectors
      .terminalSurface(page)
      .first()
      .click({ position: { x: 100, y: 60 } })
    await page.keyboard.type(
      `${initialize ? 'NATIVE_HOST_SURVIVAL=retained; ' : ''}printf '\\n${label}_%s\\n' "$NATIVE_HOST_SURVIVAL"`,
    )
    await page.keyboard.press('Enter')
    await until(() => output.includes(`${label}_retained`))
  }
  let nativeReady: number | undefined
  return {
    async afterNative(label: string, action: () => Promise<void>) {
      if (nativeReady === undefined) {
        await command('NATIVE_HOST_NATIVE_BEFORE', true)
        nativeReady = readyCount
      }
      await action()
      ok(page.context().browser()?.isConnected(), 'The existing app survives native host exit')
      await command(`NATIVE_HOST_AFTER_${label}`)
      strictEqual(readyCount, nativeReady, 'The existing native-proof shell stays connected')
    },
    async dispose() {
      const results = await Promise.all(
        [...terminals.values()].map((terminal) =>
          killCaptureTerminal(page.context().request, terminal),
        ),
      )
      ok(
        results.every((result) => result.error === null),
        'Only proof-owned terminal sessions are reaped',
      )
    },
  }
}
