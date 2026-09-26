import { ok, strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { Download, Page } from 'playwright'

import type { Scenario } from './index'
import { runPaletteCommand, selectors } from '../selectors'
import { dispatch, openChat, readShell } from './chat-verification'

const PROMPT = 'Export verification prompt'

async function downloaded(download: Promise<Download>) {
  const file = await download
  const path = await file.path()
  ok(path, 'The download must land on disk')
  return { name: file.suggestedFilename(), text: await readFile(path, 'utf8') }
}

async function waitForUserMessage(page: Page, base: string, sessionId: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const session = (await readShell(page, base)).sessions.find((s) => s.id === sessionId)
    if (session?.latestUserMessageAt && session.latestTurn?.state !== 'running') return
    await page.waitForTimeout(150)
  }
  ok(false, 'The prompt must be recorded before exporting')
}

export const exportTranscript: Scenario = {
  name: 'export-transcript',
  description:
    'One disposable session whose provider instance does not exist, so its turn fails without spending tokens. Exports it as Markdown and JSON from the rail menu, as Markdown from the message menu and from the palette, and reads each downloaded file.',
  async run(page, { step }) {
    // A fresh throwaway home has no default model, and this session needs none.
    const base = await openChat(page)
    const worktree = (await readShell(page, base)).worktrees.find((item) =>
      item.path.endsWith('/projects/platform'),
    )
    ok(worktree, 'Platform worktree must be registered')
    const sessionId = crypto.randomUUID()
    const title = `Export verification ${sessionId.slice(0, 8)}`
    await dispatch(page, base, {
      type: 'session.create',
      sessionId,
      title,
      worktreeTarget: { kind: 'current', worktreeId: worktree.id },
      modelSelection: { providerInstanceId: 'export-verification-missing', model: 'none' },
    })
    try {
      await dispatch(page, base, {
        type: 'session.turn.start',
        sessionId,
        turnId: `turn-${sessionId}`,
        interactionMode: 'default',
        runtimeMode: 'full-access',
        message: { messageId: `message-${sessionId}`, role: 'user', text: PROMPT },
      })
      await waitForUserMessage(page, base, sessionId)

      await selectors.sessionSearch(page).fill(title)
      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      await step('rail-menu')
      const markdown = downloaded(page.waitForEvent('download'))
      await selectors.menuItem(page, 'Export as Markdown…').click()
      const railMarkdown = await markdown
      ok(railMarkdown.name.endsWith('.md'), `Markdown file name: ${railMarkdown.name}`)
      ok(railMarkdown.text.startsWith(`# ${title}\n`), 'Markdown opens with the title')
      ok(railMarkdown.text.includes(`## User\n\n${PROMPT}`), 'Markdown carries the prompt')

      await selectors.sessionByTitle(page, title).click({ button: 'right' })
      const json = downloaded(page.waitForEvent('download'))
      await selectors.menuItem(page, 'Export as JSON…').click()
      const railJson = JSON.parse((await json).text)
      strictEqual(railJson.session.id, sessionId)
      strictEqual(railJson.session.messages.length, 1)
      ok(railJson.session.activities.length > 0, 'JSON carries the failed turn activity')

      await selectors.sessionByTitle(page, title).click()
      const bubble = selectors.chatMessages(page).getByText(PROMPT, { exact: true }).first()
      await bubble.waitFor()
      await bubble.click({ button: 'right' })
      await selectors.menuItem(page, 'Export Conversation as Markdown…').waitFor()
      await step('message-menu')
      const conversation = downloaded(page.waitForEvent('download'))
      await selectors.menuItem(page, 'Export Conversation as Markdown…').click()
      strictEqual((await conversation).text, railMarkdown.text)

      const palette = downloaded(page.waitForEvent('download'))
      await runPaletteCommand(page, 'Export transcript')
      strictEqual((await palette).text, railMarkdown.text)
      await step('exported')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      await dispatch(page, base, { type: 'session.delete', sessionId })
    }
  },
}
