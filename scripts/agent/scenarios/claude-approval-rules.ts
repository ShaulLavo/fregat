import { ok, strictEqual } from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { dispatch, openChat } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

const MARKER = 'marker-145.txt'
const RULE = `Bash(touch ${MARKER})`
const DONE = 'APPROVAL_RULE_HELD'
const PROMPT = `Use the Bash tool to run exactly \`touch ${MARKER}\`. Use no other tool. Then reply with exactly ${DONE}.`

/**
 * Runs the real Claude CLI (Haiku) in a disposable repository. "Always allow in this project"
 * must write the rule to `.claude/settings.local.json`, and a second session must not ask again.
 */
export const claudeApprovalRules: Scenario = {
  name: 'claude-approval-rules',
  description:
    'Real Claude session in approval-required mode: the command approval offers session and always rules, "Always allow in this project" writes settings.local.json, and a new session runs the same command without asking. Removes the fixture, sessions and project.',
  async run(page, { step }) {
    const orchestration = await openChat(page)
    const fixture = await createGitFixture('claude-approval-rules')
    const sessions: string[] = []
    let projectId: string | null = null
    try {
      // A project needs a root commit for its repository identity.
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      const worktree = await registerFixtureProject(page, orchestration, fixture)
      projectId = worktree.projectId
      const run = async (label: string) => {
        const sessionId = crypto.randomUUID()
        sessions.push(sessionId)
        await startSession(page, orchestration, worktree.id, sessionId, label)
      }

      await run('ask')
      await selectors.commandApproval(page).waitFor({ timeout: 60_000 })
      for (const label of [
        'Allow for this session',
        'Always allow in this project',
        'Always allow everywhere',
        'Allow',
      ])
        await selectors.commandApprovalDecision(page, label).waitFor()
      await step('claude-command-approval')

      await selectors.commandApprovalDecision(page, 'Always allow in this project').click()
      await selectors.commandApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
      await waitForReply(page)
      await access(path.join(fixture, MARKER))
      const settings = await readFile(path.join(fixture, '.claude', 'settings.local.json'), 'utf8')
      ok(settings.includes(RULE), `settings.local.json must hold ${RULE}`)
      await step('rule-written')

      await run('remembered')
      await waitForReply(page)
      strictEqual(await selectors.commandApproval(page).count(), 0)
      await step('second-session-not-asked')
    } catch (error) {
      await step('failed-before-cleanup')
      throw error
    } finally {
      for (const sessionId of sessions) {
        await dispatch(page, orchestration, { type: 'session.runtime.stop', sessionId })
        await dispatch(page, orchestration, { type: 'session.delete', sessionId })
      }
      if (projectId)
        await dispatch(page, orchestration, { type: 'project.delete', projectId, force: true })
      await releaseFixture(fixture)
    }
  },
}

async function startSession(
  page: Page,
  orchestration: string,
  worktreeId: string,
  sessionId: string,
  label: string,
) {
  const title = `claude-approval-rules ${label} ${sessionId.slice(0, 8)}`
  await dispatch(page, orchestration, {
    type: 'session.create',
    sessionId,
    title,
    worktreeTarget: { kind: 'current', worktreeId },
    modelSelection: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
    runtimeMode: 'approval-required',
  })
  await selectors.sessionSearch(page).fill(title)
  await selectors.sessionByTitle(page, title).click()
  await page.waitForURL((url) => url.href.includes(sessionId))
  await typePrompt(page)
  await selectors.chatSend(page).click()
}

// The prompt itself contains the word, so the reply is the second match.
async function waitForReply(page: Page) {
  const matches = selectors.chatMessages(page).getByText(DONE)
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if ((await matches.count()) >= 2) return
    await Bun.sleep(250)
  }
  ok(false, `Claude never replied ${DONE}`)
}

// The composer re-mounts once the session loads, which drops text typed before it.
async function typePrompt(page: Page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await selectors.chatMessage(page).fill(PROMPT)
    await Bun.sleep(300)
    if (await selectors.chatSend(page).isEnabled()) return
  }
  ok(false, 'The composer never accepted the prompt')
}
