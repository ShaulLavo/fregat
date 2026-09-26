import { ok, strictEqual } from 'node:assert/strict'

import { selectors } from '../selectors'
import {
  draftFixture,
  openIsolatedDraft,
  releaseStartedSessions,
  startedSessions,
} from './draft-sessions'
import { readShell } from './chat-verification'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

const PROMPT = 'Compare these two models, one reply lost.'

type RpcFrame = { kind?: string; method?: string; requestId?: string; command?: unknown }

function frame(message: string | Buffer): RpcFrame | null {
  try {
    return JSON.parse(String(message)) as RpcFrame
  } catch {
    return null
  }
}

// A lost acknowledgment must reuse the accepted start through every composer submit path.
export const chatMultipleModelsLostAck = isolatedNativeScenario({
  name: 'chat-multiple-models-lost-ack',
  description:
    'Send one draft to two models while the server’s reply to the second start is dropped and its socket closed: the draft keeps only the unconfirmed model, and retrying with Send, Enter, Ctrl+Enter or Cmd+Enter resends the same start, which the server answers as done. Two sessions and one provider turn per model.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  prepareWorktree: () => draftFixture('multiple-models-lost-ack'),
  async drive(page, context) {
    const fixtureUrl = page.url()
    for (const retry of ['Control+Enter', 'Meta+Enter', 'Enter', 'button']) {
      await page.goto(fixtureUrl)
      await verifyRetry(page, context, retry)
    }
  },
})

async function verifyRetry(
  page: Parameters<Parameters<typeof isolatedNativeScenario>[0]['drive']>[0],
  {
    step,
    orchestration,
    sessionId,
    projectId,
    providerInstanceId,
    root,
  }: Parameters<Parameters<typeof isolatedNativeScenario>[0]['drive']>[1],
  retry: string,
) {
  const previousStarts = (await nativeLog(root)).filter(
    (entry) => entry.event === 'turn/start',
  ).length
  let dropped = false
  await page.routeWebSocket(/\/orchestration\/rpc/, (socket) => {
    const server = socket.connectToServer()
    const withheld = new Set<string>()
    socket.onMessage((message) => {
      const request = frame(message)
      const mini =
        request?.method === 'dispatchCommand' &&
        JSON.stringify(request.command).includes('"model":"gpt-5.5-mini"')
      if (mini && !dropped && request?.requestId) {
        dropped = true
        withheld.add(request.requestId)
      }
      server.send(message)
    })
    server.onMessage((message) => {
      const response = frame(message)
      if (response?.kind === 'response' && response.requestId && withheld.has(response.requestId)) {
        withheld.delete(response.requestId)
        void socket.close({ code: 1011, reason: 'lost acknowledgment' })
        return
      }
      socket.send(message)
    })
  })
  // A route applies to sockets opened after it; the reload reopens the orchestration socket.
  await page.reload()
  await selectors.chatMessage(page).waitFor()
  await openIsolatedDraft(page, { orchestration, projectId, providerInstanceId })
  await selectors.modelPickerTrigger(page).click()
  await selectors.modelPickerPanel(page).waitFor({ timeout: 10_000 })
  await selectors.modelPickerOption(page, 'gpt-5.5-mini').click({ modifiers: ['Shift'] })
  await page.keyboard.press('Escape')
  await selectors.modelPickerTrigger(page).getByText('+1', { exact: true }).waitFor()

  await sendPrompt(page, PROMPT)
  let started = await startedSessions(page, orchestration, { count: 2, projectId, sessionId })
  try {
    ok(dropped, 'The second start reply was dropped and its socket closed')
    // The server did start both; the client only heard about the first.
    strictEqual(started.length, 2)
    await selectors.modelPickerTrigger(page).getByText('gpt-5.5-mini').waitFor()
    strictEqual(await selectors.modelPickerTrigger(page).getByText('+1').count(), 0)
    strictEqual((await selectors.chatMessage(page).textContent())?.trim(), PROMPT)
    await step(`${retry}-unconfirmed-model-stays-on-the-draft`)

    const draftUrl = page.url()
    if (retry === 'button') await selectors.chatSend(page).click()
    else await selectors.chatMessage(page).press(retry)
    await selectors
      .chatMessage(page)
      .getByText(PROMPT)
      .waitFor({ state: 'detached', timeout: 30_000 })
    if (retry === 'Control+Enter' || retry === 'Meta+Enter')
      strictEqual(page.url(), draftUrl, 'A background retry keeps the user on a fresh draft')
    await Bun.sleep(1_000)
    started = await startedSessions(page, orchestration, { count: 2, projectId, sessionId })
    const shell = await readShell(page, orchestration)
    const linked = shell.sessions.filter((session) =>
      shell.worktrees.some(
        (tree) =>
          tree.id === session.worktreeId && tree.projectId === projectId && tree.kind === 'linked',
      ),
    )
    strictEqual(
      shell.sessions.filter((session) =>
        shell.worktrees.some(
          (tree) => tree.id === session.worktreeId && tree.projectId === projectId,
        ),
      ).length,
      3,
      'The fixture session and exactly two model sessions remain after retry',
    )
    strictEqual(linked.length, 2, 'The retry is the same start, never a third session')
    const starts = (await nativeLog(root))
      .filter((entry) => entry.event === 'turn/start')
      .slice(previousStarts)
    strictEqual(starts.filter((entry) => entry.model === 'gpt-5.5-mini').length, 1)
    strictEqual(starts.filter((entry) => entry.model === 'gpt-5.5').length, 1)
    await step(`${retry}-retry-starts-nothing-twice`)
  } finally {
    await releaseStartedSessions(page, orchestration, started)
  }
}
