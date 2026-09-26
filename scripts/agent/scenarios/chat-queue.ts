import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'
import * as v from 'valibot'
import { attachmentUploadTicketSchema } from '../../../packages/contracts/src/index'
import { installCaptureSocketPrefix, killCaptureTerminal } from '../product-terminal'
import { runPaletteCommand, selectors } from '../selectors'
import {
  isolatedNativeScenario,
  nativeLog,
  restoreUserSettings,
  settingsSnapshot,
  writeSettings,
} from './native-provider-verification'

const inputSchema = v.object({
  event: v.string(),
  input: v.array(v.object({ type: v.string(), text: v.optional(v.string()) })),
  files: v.array(v.object({ path: v.string(), contents: v.string() })),
})
const marker = 'QUEUE_TERMINAL_CONTEXT'
const fileContent = 'Queued file must survive Stop.\n'

async function until(condition: () => Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return
    await Bun.sleep(50)
  }
  ok(false, label)
}

async function inputEntries(root: string) {
  const entries = await nativeLog(root)
  return entries
    .filter((entry) => entry.event === 'turn/start' || entry.event === 'turn/steer')
    .map((entry) => v.parse(inputSchema, entry))
}

async function waitForInputs(root: string, count: number) {
  await until(
    async () => (await inputEntries(root)).length === count,
    `Expected ${count} native inputs`,
  )
  return inputEntries(root)
}

async function control(
  root: string,
  action: 'boundary' | 'approval' | 'complete' | 'reject-interrupt',
) {
  const id = crypto.randomUUID()
  await writeFile(join(root, 'queue-control.json'), JSON.stringify({ id, action }))
  await until(
    async () =>
      (await nativeLog(root)).some((entry) => entry.event === 'control' && entry.id === id),
    `Native fixture must observe ${action}`,
  )
}

async function enqueue(page: Page, prompt: string) {
  await selectors.fillChatMessage(page, prompt)
  await selectors.chatQueue(page).click()
  await selectors.chatQueuedEntry(page, prompt).waitFor()
}

async function expectQueued(page: Page, count: number) {
  await until(
    async () => (await selectors.chatSendQueued(page).count()) === count,
    `${count} queued entries`,
  )
}

async function isolateTerminals(page: Page) {
  const prefix = `queue-verification-${crypto.randomUUID()}-`
  const owners = new Map<string, URL>()
  const state = { ready: false, output: '' }
  await page.addInitScript(installCaptureSocketPrefix, prefix)
  page.on('websocket', (socket) => {
    const url = new URL(socket.url())
    if (!url.pathname.endsWith('/terminal')) return
    if (!url.searchParams.get('terminalId')?.startsWith(prefix)) return
    owners.set(socket.url(), url)
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') {
        state.output += payload.toString('utf8')
        return
      }
      if (JSON.parse(payload).type === 'ready') state.ready = true
    })
  })
  await page.reload()
  await selectors.chatMessage(page).waitFor()
  return { owners, state }
}

async function attachTerminal(page: Page, state: { ready: boolean; output: string }) {
  await runPaletteCommand(page, 'Show terminal')
  await selectors.terminalSurface(page).first().waitFor()
  await until(async () => state.ready, 'Owned terminal must become ready')
  await selectors
    .terminalSurface(page)
    .first()
    .click({ position: { x: 100, y: 60 } })
  await page.keyboard.type(`printf '\\nQUEUE_%s\\n' 'TERMINAL_CONTEXT'`)
  await page.keyboard.press('Enter')
  await until(async () => state.output.includes(marker), 'Owned terminal must print its marker')
  await selectors
    .terminalSurface(page)
    .first()
    .click({ button: 'right', position: { x: 100, y: 60 } })
  await selectors.terminalSelectAll(page).click()
  await selectors
    .terminalSurface(page)
    .first()
    .click({ button: 'right', position: { x: 100, y: 60 } })
  await selectors.terminalAskAgent(page).click()
  await selectors.chatTerminalContext(page).waitFor()
  const text = await selectors.chatTerminalContext(page).getAttribute('title')
  ok(text?.includes(marker), 'The composer must carry the real selected terminal output')
  return text
}

async function releaseTerminals(page: Page, owners: Map<string, URL>, root: string) {
  for (const url of owners.values()) {
    const terminalId = url.searchParams.get('terminalId')
    const worktreeId = url.searchParams.get('worktreeId')
    ok(terminalId && worktreeId, 'Owned terminal must retain both resource identities')
    const base = `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}${url.pathname}`
    const clear = await page.request.post(`${base}/clear`, {
      headers: { Origin: new URL(page.url()).origin },
      data: { worktreeId, terminalId },
    })
    const kill = await killCaptureTerminal(page.request, {
      socketUrl: url.href,
      killUrl: `${base}/kill`,
      worktreeId,
      terminalId,
    })
    await appendFile(
      join(root, 'native.jsonl'),
      `${JSON.stringify({
        event: 'terminal-cleanup',
        worktreeId,
        terminalId,
        clearStatus: clear.status(),
        killed: kill.killed,
        killError: kill.error,
      })}\n`,
    )
    ok(clear.ok() && kill.error === null, 'Owned terminal history and process must be removed')
  }
}

export const chatQueue = isolatedNativeScenario({
  name: 'chat-queue',
  description:
    'Queue FIFO follow-ups at tool boundaries, hold for approval, send or restore explicitly, and recover text/file/terminal payload before a rejected Stop.',
  fixture: new URL('../fixtures/native-queue.mjs', import.meta.url),
  async drive(page, { step, root, orchestration }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const before = await settingsSnapshot(page, base)
    const { owners, state } = await isolateTerminals(page)
    let uploadPath: string | undefined
    let recoveredSent = false
    try {
      await writeSettings(page, base, [{ kind: 'reset', keys: ['chat.followUpBehavior'] }])
      strictEqual((await settingsSnapshot(page, base)).values['chat.followUpBehavior'], 'queue')
      await selectors.fillChatMessage(page, 'QUEUE_START')
      await selectors.chatSend(page).click()
      await waitForInputs(root, 1)
      await enqueue(page, 'QUEUE_A')
      await enqueue(page, 'QUEUE_B')
      await expectQueued(page, 2)
      strictEqual(
        (await inputEntries(root)).length,
        1,
        'Typing follow-ups must not steer immediately',
      )
      await step('default-queues-two-follow-ups')

      await control(root, 'boundary')
      const afterFirst = await waitForInputs(root, 2)
      strictEqual(afterFirst[1]?.input[0]?.text, 'QUEUE_A')
      await expectQueued(page, 1)
      await Bun.sleep(200)
      strictEqual((await inputEntries(root)).length, 2, 'One tool completion releases one message')
      await step('one-tool-boundary-releases-only-first')

      await control(root, 'approval')
      await selectors.appApproval(page).waitFor()
      await control(root, 'boundary')
      await Bun.sleep(200)
      strictEqual((await inputEntries(root)).length, 2, 'Approval holds the due head')
      await expectQueued(page, 1)
      await step('approval-holds-next-follow-up')
      await selectors.appApprovalDecision(page, 'Approve').click()
      const afterApproval = await waitForInputs(root, 3)
      strictEqual(afterApproval[2]?.input[0]?.text, 'QUEUE_B')
      await expectQueued(page, 0)
      await step('approval-clears-without-another-boundary')

      await enqueue(page, 'QUEUE_EXPLICIT')
      await selectors.chatSendQueued(page).click()
      const afterExplicit = await waitForInputs(root, 4)
      strictEqual(afterExplicit[3]?.input[0]?.text, 'QUEUE_EXPLICIT')
      await enqueue(page, 'QUEUE_RESTORE')
      await selectors.chatRestoreQueued(page).click()
      await expectQueued(page, 0)
      strictEqual(await selectors.chatMessage(page).textContent(), 'QUEUE_RESTORE')
      await step('send-now-and-restore')
      await selectors.fillChatMessage(page, '')

      const terminalText = await attachTerminal(page, state)
      const issued = page.waitForResponse(
        (response) =>
          response.url() === `${base}/attachments/uploads` &&
          response.request().method() === 'POST',
      )
      await selectors.chatComposerFileInput(page).setInputFiles({
        name: 'queued.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContent),
      })
      const ticket = v.parse(attachmentUploadTicketSchema, await (await issued).json())
      uploadPath = `${base}/attachments/uploads/${ticket.attachment.id}`
      await selectors.chatStagedFile(page, 'queued.txt').waitFor()
      await enqueue(page, 'QUEUE_RECOVER')
      await selectors.fillChatMessage(page, 'EXISTING_DRAFT')
      await selectors.chatStop(page).click()
      await expectQueued(page, 0)
      await selectors.chatStagedFile(page, 'queued.txt').waitFor()
      await selectors.chatTerminalContext(page).waitFor()
      strictEqual(await selectors.chatTerminalContext(page).getAttribute('title'), terminalText)
      const restored = await selectors.chatMessage(page).textContent()
      ok(restored?.includes('EXISTING_DRAFT') && restored.includes('QUEUE_RECOVER'))
      await until(
        async () => (await nativeLog(root)).some((entry) => entry.event === 'interrupt-requested'),
        'Native interrupt must be waiting while the complete draft is already restored',
      )
      await step('stop-restores-complete-payload-before-interrupt-result')
      await control(root, 'reject-interrupt')
      await until(
        async () => (await nativeLog(root)).some((entry) => entry.event === 'interrupt-rejected'),
        'The native interrupt must reject',
      )
      await Bun.sleep(200)
      strictEqual(await selectors.chatMessage(page).textContent(), restored)
      strictEqual(await selectors.chatTerminalContext(page).getAttribute('title'), terminalText)
      await selectors.chatStagedFile(page, 'queued.txt').waitFor()
      strictEqual((await inputEntries(root)).length, 4, 'Stop must not dispatch recovered content')
      await step('interrupt-failure-keeps-restored-draft')

      await control(root, 'complete')
      await selectors.chatSend(page).click()
      await selectors
        .chatMessages(page)
        .getByText('QUEUE_PAYLOAD_VERIFIED', { exact: true })
        .waitFor()
      const inputs = await waitForInputs(root, 5)
      const recovered = inputs[4]
      ok(recovered, 'Recovered payload must reach native turn input')
      deepStrictEqual(
        recovered.files.map((file) => file.contents),
        [fileContent],
      )
      const text = recovered.input
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
      ok(text.includes('EXISTING_DRAFT') && text.includes('QUEUE_RECOVER') && text.includes(marker))
      ok(text.includes('<terminal_context>'), 'Terminal context keeps its structured payload')
      recoveredSent = true
      await step('recovered-file-and-terminal-reach-native-provider')
    } finally {
      await restoreUserSettings(page, base, before, ['chat.followUpBehavior'])
      if (uploadPath && !recoveredSent) {
        const removed = await page.request.delete(uploadPath, {
          headers: { Origin: new URL(page.url()).origin },
        })
        ok(
          removed.ok() || removed.status() === 409,
          'Pending upload cleanup must succeed or defer to its session owner',
        )
      }
      await releaseTerminals(page, owners, root)
    }
  },
})
