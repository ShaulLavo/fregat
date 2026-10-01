import { stageRelease } from './server-update'
import { processExists } from '../../../apps/server/scripts/process-exists'
import { committedFixture } from '../fixture-workspace'
import { dispatch, readShell, waitForCompletedTurn } from './chat-verification'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'
import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { installCaptureTerminalNamespace } from '../product-terminal'
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
  await installCaptureTerminalNamespace(page, prefix)
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
  if (await selectors.terminalSurface(page).first().isVisible()) return
  await selectors.windowToolbar(page).click({ position: { x: 300, y: 10 } })
  await runPaletteCommand(page, 'Show terminal')
  await selectors.terminalSurface(page).first().waitFor()
}

export const terminalHistory: Scenario = {
  name: 'terminal-history',
  description:
    'Create an isolated shell, replay output to a second viewer and reconnect, then clear shared history and verify replay stays empty.',
  inspect: async (page) => inspection.get(page) ?? null,
  async run(page, { step, server }) {
    ok(server, 'Terminal restart proof needs a throwaway API server')
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
        .click({ position: { x: 100, y: 60 } })
      await page.keyboard.type(
        'PLAN126_API_TOKEN=survives; printf "\\nAPI_BEFORE_%s\\n" "$PLAN126_API_TOKEN"',
      )
      await page.keyboard.press('Enter')
      await until(
        page,
        () => first.at(-1)?.output.includes('API_BEFORE_survives') === true,
        'Shell has restart token',
      )
      const firstCount = first.length
      const secondCount = other.length
      await stageRelease(server)
      await selectors.serverUpdateRestart(page).waitFor()
      await selectors.serverUpdateRestart(page).click()
      await selectors.serverUpdate(page).waitFor({ state: 'detached', timeout: 20_000 })
      await until(
        page,
        () =>
          first.length > firstCount &&
          other.length > secondCount &&
          first.at(-1)?.ready === true &&
          other.at(-1)?.ready === true,
        'Both viewers reconnect after API restart',
      )
      ok(
        first.at(-1)?.output.includes(marker) && other.at(-1)?.output.includes(marker),
        'Both viewers replay the pre-restart history',
      )
      await selectors
        .terminalSurface(page)
        .first()
        .click({ position: { x: 100, y: 60 } })
      await page.keyboard.type('printf "\\nAPI_AFTER_%s\\n" "$PLAN126_API_TOKEN"')
      await page.keyboard.press('Enter')
      await until(
        page,
        () =>
          first.at(-1)?.output.includes('API_AFTER_survives') === true &&
          other.at(-1)?.output.includes('API_AFTER_survives') === true,
        'The same shell serves both viewers after API restart',
      )
      await step('api-restart-preserves-shell-history-and-two-viewers')
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

async function typeShellCommand(page: Page, command: string) {
  await selectors
    .terminalSurface(page)
    .first()
    .click({ position: { x: 100, y: 60 } })
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

async function shellPid(page: Page, connection: ObservedTerminal, label: string) {
  await typeShellCommand(page, `printf '\\n${label}_%s\\n' "$$"`)
  const match = () => new RegExp(`(?:^|[\r\n])${label}_(\\d+)[\r\n]`).exec(connection.output)
  await until(page, () => match() !== null, 'The native shell reports its process id')
  return Number(match()![1])
}

export const terminalIdleShells = isolatedNativeScenario({
  name: 'terminal-idle-shells',
  description:
    'Settle native fixture sessions on a disposable worktree: another live owner keeps shells, the last owner closes only idle shells, and reconnect replays retained output.',
  fixture: new URL('../fixtures/native-conversation.mjs', import.meta.url),
  prepareWorktree: () => committedFixture('terminal-idle-shells'),
  async drive(page, { step, orchestration, sessionId, worktreeId, providerInstanceId }) {
    await sendPrompt(page, 'Reply with exactly IDLE_SHELL_NATIVE_VERIFIED.')
    await selectors
      .chatMessages(page)
      .getByText('IDLE_SHELL_NATIVE_VERIFIED', { exact: true })
      .waitFor()
    await waitForCompletedTurn(page, orchestration, sessionId)
    const session = (await readShell(page, orchestration)).sessions.find(
      (item) => item.id === sessionId,
    )
    ok(session, 'The native fixture session exists')
    const otherId = crypto.randomUUID()
    const otherTitle = `Idle-shell second owner ${otherId.slice(0, 8)}`
    const prefix = `idle-shell-verification-${crypto.randomUUID()}-`
    const owners = new Map<string, URL>()
    const connections = await isolate(page, prefix, owners)
    await dispatch(page, orchestration, {
      type: 'session.create',
      sessionId: otherId,
      title: otherTitle,
      worktreeTarget: { kind: 'current', worktreeId },
      modelSelection: { providerInstanceId, model: 'gpt-5.5' },
    })
    try {
      await page.reload()
      await showTerminal(page)
      await until(page, () => connections.at(-1)?.ready === true, 'Idle shell attaches')
      const idle = connections.at(-1)!
      const idlePid = await shellPid(page, idle, 'IDLE_PID')
      await step('native-shell-at-idle-prompt')
      await selectors.newTerminal(page).click()
      await until(
        page,
        () => connections.length >= 2 && connections.at(-1)?.ready === true,
        'Busy shell attaches',
      )
      const idleTabId = await selectors
        .terminalRows(page)
        .first()
        .getAttribute('data-terminal-tab-id')
      ok(idleTabId, 'The idle terminal has a tab identity')
      const busy = connections.at(-1)!
      const busyPid = await shellPid(page, busy, 'BUSY_PID')
      await typeShellCommand(
        page,
        `printf '\\nBUSY_RUNNING\\n'; sleep 120; printf '\\nBUSY_FINISHED\\n'`,
      )
      await until(
        page,
        () => /[\r\n]BUSY_RUNNING[\r\n]/.test(busy.output),
        'Native foreground command starts',
      )
      ok(
        processExists(idlePid) && processExists(busyPid),
        'Both native shell processes exist before settlement',
      )
      for (const url of owners.values())
        strictEqual(
          url.searchParams.get('worktreeId'),
          worktreeId,
          'Only the disposable worktree owns these shells',
        )
      await step('native-idle-prompt-and-busy-command')
      await selectors.workspaceMode(page, 'Chat').click()
      await selectors.terminalTool(page).click()
      await selectors.sessionSearch(page).fill('')
      await selectors.sessionByTitle(page, session.title).click({ button: 'right' })
      await selectors.sessionLifecycleAction(page, 'Mark as settled').click()
      await selectors.sessionInShelf(page, session.title, 'Settled').waitFor()
      await page.waitForTimeout(500)
      ok(
        processExists(idlePid) && processExists(busyPid),
        'Another live session retains both shells',
      )
      await step('another-live-owner-keeps-both-shells')
      await selectors.sessionByTitle(page, otherTitle).click({ button: 'right' })
      await selectors.sessionLifecycleAction(page, 'Mark as settled').click()
      await selectors.sessionInShelf(page, otherTitle, 'Settled').waitFor()
      await until(
        page,
        () => !processExists(idlePid),
        'The last live owner closes the idle prompt shell',
      )
      ok(
        processExists(busyPid),
        'The shell running a foreground command survives last-owner settlement',
      )
      strictEqual(/[\r\n]BUSY_FINISHED[\r\n]/.test(busy.output), false)
      await step('last-owner-closes-idle-and-keeps-busy')
      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.terminalById(page, idleTabId).click()
      const previousConnections = connections.length
      const replayConnection = () =>
        connections
          .slice(previousConnections)
          .find((connection) => connection.socketUrl === idle.socketUrl)
      await page.reload()
      await showTerminal(page)
      // Reattachment starts a fresh shell and replays the closed prompt's retained bytes.
      await until(page, () => replayConnection()?.ready === true, 'Closed shell reattaches')
      const replay = replayConnection()!
      await until(
        page,
        () => new RegExp(`[\r\n]IDLE_PID_${idlePid}[\r\n]`).test(replay.output),
        'Closed shell history replays',
      )
      const replacementPid = await shellPid(page, replay, 'REPLACEMENT_PID')
      ok(
        replacementPid !== idlePid && processExists(replacementPid),
        'Reattachment starts a replacement process',
      )
      await step('closed-idle-output-replayed-in-replacement-shell')
      return {
        idlePid,
        busyPid,
        replacementPid,
        otherLiveOwnerRetainedShells: true,
        lastOwnerClosedIdle: !processExists(idlePid),
        busySurvived: processExists(busyPid),
        replayedIdleOutput: replay.output,
        ownedTerminals: [...owners.values()].map((url) => ({
          worktreeId: url.searchParams.get('worktreeId'),
          terminalId: url.searchParams.get('terminalId'),
        })),
      }
    } finally {
      // A renderer failure must not prevent the capture-owned shells and session from closing.
      await page.goto('about:blank').catch(() => undefined)
      for (const url of owners.values()) {
        const base = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}${url.pathname}`
        const response = await page.request.post(`${base}/kill`, {
          headers: { Origin: new URL(base).origin },
          data: {
            worktreeId: url.searchParams.get('worktreeId'),
            terminalId: url.searchParams.get('terminalId'),
          },
        })
        strictEqual(response.status(), 200, 'Owned shell cleanup succeeds')
      }
      await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId: otherId })
      await dispatch(page, orchestration, { type: 'session.delete', sessionId: otherId })
    }
  },
})
