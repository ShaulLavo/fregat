import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { ok, strictEqual } from 'node:assert/strict'
import type { Page, WebSocketRoute } from 'playwright'
import { countBlankFrames, recordFrames } from '../blank-frames'
import { selectors, chatMessagesLogSelector } from '../selectors'
import { dispatch, readShell } from './chat-verification'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

export const sessionNoFlicker = isolatedNativeScenario({
  name: 'session-no-flicker',
  description:
    'Switch cold conversations in chat and the sidebar, checking blank frames, paired titles and scroll isolation with a fixture provider.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, providerInstanceId, sessionId, worktreeId }) {
    const duplicateKeys: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('Encountered two children with the same key'))
        duplicateKeys.push(message.text())
    })
    const ids = [sessionId, crypto.randomUUID(), crypto.randomUUID()]
    const titles = ['Switch alpha', 'Switch bravo', 'Switch charlie']
    try {
      await dispatch(page, orchestration, {
        type: 'session.meta.update',
        sessionId,
        title: titles[0],
      })
      for (let index = 0; index < ids.length; index += 1) {
        if (index > 0)
          await dispatch(page, orchestration, {
            type: 'session.create',
            sessionId: ids[index],
            title: titles[index],
            modelSelection: { providerInstanceId, model: 'gpt-5.5' },
            worktreeTarget: { kind: 'current', worktreeId },
          })
        await selectors.sessionSearch(page).fill(titles[index]!)
        await selectors.sessionByTitle(page, titles[index]!).click()
        await selectors.conversationTitle(page, titles[index]!).waitFor()
        await sendPrompt(page, titles[index]!)
        await selectors
          .chatMessages(page)
          .getByText(`${titles[index]} row 44`, { exact: true })
          .waitFor()
        await dispatch(page, orchestration, {
          type: 'session.meta.update',
          sessionId: ids[index],
          title: titles[index],
        })
        await selectors.sessionByTitle(page, titles[index]!).waitFor()
      }
      let unavailableSessionId: string | null = null
      await page.routeWebSocket(/\/orchestration\/rpc(?:\?|$)/, (route) =>
        connectSessionStream(route, () => unavailableSessionId),
      )
      const blanks: number[] = []
      const mismatches: number[] = []
      const waits: number[] = []
      for (const surface of ['main', 'sidebar'] as const) {
        if (surface === 'sidebar') {
          await selectors.workspaceMode(page, 'Workbench').click()
          await selectors.sidebarTab(page, 'Chat').click()
        }
        await page.reload()
        await page.locator(selectors.chatMarkdownSelector).first().waitFor()
        const terminal =
          surface === 'sidebar'
            ? await selectors.terminalSurface(page).first().elementHandle()
            : null
        if (surface === 'sidebar') ok(terminal, 'The workbench terminal is mounted')
        const frames = await recordFrames<{ title: string; body: string; loading: boolean }>(
          page,
          `() => ({
          title: Array.from(document.querySelectorAll(${JSON.stringify(selectors.conversationTitleSelector)})).map(e => e.textContent).join(' '),
          body: document.querySelector(${JSON.stringify(selectors.chatMarkdownSelector)})?.textContent?.slice(0, 100) ?? '',
          blankDOM: document.querySelector(${JSON.stringify(selectors.chatMarkdownSelector)}) ? undefined : document.querySelector(${JSON.stringify(chatMessagesLogSelector)})?.outerHTML.slice(0, 5000),
          loading: Boolean(document.querySelector(${JSON.stringify(selectors.conversationLoadingSelector)})),
        })`,
          async () => {
            const blank = await countBlankFrames(page, selectors.chatMarkdownSelector, async () => {
              for (const title of titles) {
                await selectConversation(page, surface, title)
                await selectors
                  .chatMessages(page)
                  .getByText(`${title} row 44`, { exact: true })
                  .waitFor()
                await page.waitForTimeout(150)
              }
            })
            blanks.push(blank)
            await step(`${surface}-blank-frames-${blank}`)
          },
        )
        await appendFile(
          path.join(root, 'native.jsonl'),
          `${JSON.stringify({ event: 'conversation-switch-frames', result: { surface, frames } })}\n`,
        )
        ok(frames.length > 0, 'Recorded conversation frames')
        const mismatched = frames.filter(
          (frame) =>
            !titles.some((title) => frame.title.includes(title) && frame.body.includes(title)),
        ).length
        waits.push(frames.filter((frame) => frame.loading).length)
        mismatches.push(mismatched)
        await step(`${surface}-mismatched-frames-${mismatched}`)
        await selectors.chatMessages(page).focus()
        await page.keyboard.press('Control+Home')
        await selectConversation(page, surface, titles[0]!)
        await selectors
          .chatMessages(page)
          .getByText(`${titles[0]} row 44`, { exact: true })
          .waitFor()
        await page.waitForTimeout(200)
        ok(
          await selectors.chatMessages(page).evaluate((element) => element.scrollTop > 0),
          'The next session did not inherit the previous session’s top scroll position',
        )
        if (terminal)
          ok(
            await terminal.evaluate((element) => element.isConnected),
            'The workbench terminal stayed mounted through session switches',
          )
        await step(`${surface}-scroll-isolated`)
      }
      for (const surface of ['sidebar', 'main'] as const) {
        if (surface === 'main') await selectors.workspaceMode(page, 'Chat').click()
        unavailableSessionId = crypto.randomUUID()
        ids.push(unavailableSessionId)
        const title = `Unavailable ${surface}`
        await dispatch(page, orchestration, {
          type: 'session.create',
          sessionId: unavailableSessionId,
          title,
          modelSelection: { providerInstanceId, model: 'gpt-5.5' },
          worktreeTarget: { kind: 'current', worktreeId },
        })
        await selectConversation(page, surface, title)
        await selectors.conversationTitle(page, title).waitFor()
        await selectors.chatReconnecting(page).waitFor()
        strictEqual(await page.locator(selectors.conversationLoadingSelector).count(), 0)
        await step(`${surface}-uncached-session-reconnecting`)
      }
      strictEqual(duplicateKeys.length, 0, duplicateKeys.join('\n'))
      strictEqual(blanks[0], 0, 'Main conversation blanked while switching sessions')
      strictEqual(blanks[1], 0, 'Sidebar conversation blanked while switching sessions')
      strictEqual(mismatches[0], 0, 'Main header and body name the same conversation')
      strictEqual(mismatches[1], 0, 'Sidebar header and body name the same conversation')
      ok(
        waits.every((count) => count > 0),
        'Both headers showed a loading spinner while holding the conversation',
      )
    } finally {
      const remaining = await readShell(page, orchestration)
      for (const id of ids.slice(1)) {
        if (!remaining.sessions.some((session) => session.id === id)) continue
        await dispatch(page, orchestration, { type: 'session.delete', sessionId: id })
      }
    }
  },
})

async function selectConversation(page: Page, surface: 'main' | 'sidebar', title: string) {
  if (surface === 'main') {
    await selectors.sessionSearch(page).fill(title)
    await selectors.sessionByTitle(page, title).click()
    return
  }
  await selectors.conversationHistory(page).click()
  await selectors.conversationChoice(page, title).click()
}

function connectSessionStream(route: WebSocketRoute, unavailableSessionId: () => string | null) {
  const server = route.connectToServer()
  route.onMessage((message) => {
    const frame = JSON.parse(message.toString())
    if (frame.method === 'subscribeSession' && frame.sessionId === unavailableSessionId()) {
      route.send(
        JSON.stringify({
          kind: 'subscription.error',
          subscriptionId: frame.subscriptionId,
          error: { status: 503, message: 'Fixture session temporarily unavailable' },
        }),
      )
      return
    }
    if (frame.method === 'subscribeSession') setTimeout(() => server.send(message), 450)
    else server.send(message)
  })
}
