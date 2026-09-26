import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { installCaptureSocketPrefix } from '../product-terminal'
import { runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'
import { openWiredContextPage } from '../wired-context'

type ObservedTerminal = {
  output: string
  clears: number
  ready: boolean
  readyCount: number
  socketUrl: string
}
const inspection = new WeakMap<Page, unknown>()

async function isolate(page: Page, prefix: string, owners: Map<string, URL>) {
  const connections: ObservedTerminal[] = []
  await page.addInitScript(installCaptureSocketPrefix, prefix)
  await page.route(/\/terminal\/(?:clear|kill|restart)$/, async (route) => {
    const body = route.request().postDataJSON()
    ok(typeof body?.terminalId === 'string', 'Terminal mutation must carry an ID')
    const terminalId = body.terminalId.startsWith(prefix)
      ? body.terminalId
      : prefix + body.terminalId
    await route.continue({ postData: JSON.stringify({ ...body, terminalId }) })
  })
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (!url.pathname.endsWith('/terminal')) return
    const terminalId = url.searchParams.get('terminalId')
    ok(terminalId?.startsWith(prefix), 'Only owned terminals may connect during this scenario')
    ok(!url.searchParams.has('agentSessionId'), 'History scenario requires an ordinary shell')
    owners.set(socket.url(), url)
    const connection: ObservedTerminal = {
      output: '',
      clears: 0,
      ready: false,
      readyCount: 0,
      socketUrl: socket.url(),
    }
    connections.push(connection)
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') {
        connection.output += payload.toString('utf8')
        return
      }
      const message = JSON.parse(payload)
      if (message.type === 'ready') {
        connection.ready = true
        connection.readyCount++
      }
      if (message.type === 'cleared') {
        connection.clears++
        connection.output = ''
      }
    })
  })
  return connections
}

async function until(page: Page, condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return
    await page.waitForTimeout(50)
  }
  ok(condition(), label)
}

async function showTerminal(page: Page) {
  await waitForApp(page)
  await runPaletteCommand(page, 'Show terminal')
  await selectors.terminalSurface(page).first().waitFor()
}

export const terminalHistory: Scenario = {
  name: 'terminal-history',
  description:
    'Create an isolated shell, replay output to a second viewer and reconnect, then clear shared history and verify replay stays empty.',
  inspect: async (page) => inspection.get(page) ?? null,
  async run(page, { step }) {
    const prefix = `history-verification-${crypto.randomUUID()}-`
    const suffix = `HISTORY_${crypto.randomUUID().replaceAll('-', '')}`
    const marker = `TERMINAL_${suffix}`
    const owners = new Map<string, URL>()
    const first = await isolate(page, prefix, owners)
    let secondWindow: Awaited<ReturnType<typeof openWiredContextPage>> | undefined
    let cleanupComplete = false
    try {
      await page.reload()
      await showTerminal(page)
      await until(page, () => first.at(-1)?.ready === true, 'Owned terminal must become ready')
      await selectors
        .terminalSurface(page)
        .first()
        .click({ position: { x: 100, y: 60 } })
      await page.keyboard.type(`printf '\\nTERMINAL_%s\\n' '${suffix}'`)
      await page.keyboard.press('Enter')
      await until(
        page,
        () => first.at(-1)?.output.includes(marker) === true,
        'Shell must output the marker',
      )
      await step('owned-terminal-output')
      secondWindow = await openWiredContextPage(page)
      const second = secondWindow.page
      const other = await isolate(second, prefix, owners)
      await second.goto(page.url())
      await showTerminal(second)
      await until(
        second,
        () => other.at(-1)?.output.includes(marker) === true,
        'Second viewer must replay shared output',
      )
      strictEqual(
        new URL(first.at(-1)!.socketUrl).searchParams.get('terminalId'),
        new URL(other.at(-1)!.socketUrl).searchParams.get('terminalId'),
      )
      await page.reload()
      await showTerminal(page)
      await until(
        page,
        () => first.at(-1)?.output.includes(marker) === true,
        'Reconnect must replay marker',
      )
      await step('history-replayed-with-second-viewer')
      await selectors
        .terminalSurface(page)
        .first()
        .click({ button: 'right', position: { x: 100, y: 60 } })
      await selectors.clearTerminalHistory(page).click()
      await until(
        page,
        () => first.at(-1)?.clears === 1 && other.at(-1)?.clears === 1,
        'Both viewers must receive confirmed clear',
      )
      await step('shared-history-cleared')
      const count = first.length
      await page.reload()
      await showTerminal(page)
      await until(
        page,
        () => first.length > count && first.at(-1)?.ready === true,
        'Reconnect after clear must become ready',
      )
      await page.waitForTimeout(300)
      strictEqual(first.at(-1)?.output.includes(marker), false)
      await step('reconnect-keeps-history-cleared')
      await selectors
        .terminalSurface(page)
        .first()
        .click({ position: { x: 100, y: 60 } })
      await page.keyboard.type(
        'PLAN126_RESTART_TOKEN=old; printf "\\nRESTART_BEFORE_%s\\n" "$PLAN126_RESTART_TOKEN"',
      )
      await page.keyboard.press('Enter')
      await until(
        page,
        () => first.at(-1)?.output.includes('RESTART_BEFORE_old') === true,
        'The original shell must retain its variable',
      )
      const readyCount = first.at(-1)!.readyCount
      const otherReadyCount = other.at(-1)!.readyCount
      await selectors
        .terminalSurface(page)
        .first()
        .click({ button: 'right', position: { x: 100, y: 60 } })
      await selectors.restartTerminalShell(page).click()
      await until(
        page,
        () => first.at(-1)!.readyCount > readyCount && other.at(-1)!.readyCount > otherReadyCount,
        'Both viewers must attach to the replacement process',
      )
      await selectors
        .terminalSurface(page)
        .first()
        .click({ position: { x: 100, y: 60 } })
      await page.keyboard.type('printf "\\nRESTART_AFTER_%s\\n" "${PLAN126_RESTART_TOKEN-unset}"')
      await page.keyboard.press('Enter')
      await until(
        page,
        () =>
          first.at(-1)?.output.includes('RESTART_AFTER_unset') === true &&
          other.at(-1)?.output.includes('RESTART_AFTER_unset') === true,
        'A new shell must serve both existing viewers',
      )
      strictEqual(first.at(-1)?.output.includes('RESTART_BEFORE_old'), false)
      await step('restart-replaces-process-and-preserves-viewers')
    } finally {
      await secondWindow?.close()
      await page.goto('about:blank')
      const results = []
      for (const url of owners.values()) {
        const base = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}${url.pathname}`
        const data = {
          worktreeId: url.searchParams.get('worktreeId'),
          terminalId: url.searchParams.get('terminalId'),
        }
        const headers = { Origin: new URL(base).origin }
        const clear = await page.request.post(`${base}/clear`, { headers, data })
        const killed = await page.request.post(`${base}/kill`, { headers, data })
        results.push({ ...data, clearStatus: clear.status(), killStatus: killed.status() })
      }
      cleanupComplete = results.every(
        (result) => result.clearStatus === 200 && result.killStatus === 200,
      )
      inspection.set(page, { prefix, marker, cleanupComplete, owners: results })
      ok(cleanupComplete, 'All owned terminal histories and processes must be cleaned')
    }
  },
}
