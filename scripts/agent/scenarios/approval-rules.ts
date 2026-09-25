import { ok, strictEqual } from 'node:assert/strict'
import { access, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { dispatch, openChat } from './chat-verification'
import { registerFixtureProject } from './native-provider-verification'

const MARKER = 'marker-145.txt'
const DONE = 'APPROVAL_RULE_HELD'
const ALWAYS_TOUCH = /^Always allow commands starting with touch/
const CODEX_RULES = path.join(homedir(), '.codex', 'rules', 'default.rules')

type ApprovalRulesProvider = {
  readonly name: string
  readonly description: string
  readonly model: { providerInstanceId: string; model: string }
  readonly prompt: string
  /** The options the command approval must offer, in order. */
  readonly options: readonly (string | RegExp)[]
  readonly always: string | RegExp
  /** Checks the rule landed in the harness's own store. */
  readonly ruleWritten: (fixture: string) => Promise<void>
  /** Runs around the whole drive; puts back anything outside the fixture the run wrote. */
  readonly preserve?: () => Promise<() => Promise<void>>
}

/**
 * Real provider runs in a disposable repository: the command approval offers the rule the
 * harness proposes, choosing it writes the harness's own rule store, and a second session
 * runs the same command without asking.
 */
function approvalRulesScenario(provider: ApprovalRulesProvider): Scenario {
  return {
    name: provider.name,
    description: provider.description,
    async run(page, { step }) {
      const orchestration = await openChat(page)
      const fixture = await createGitFixture(provider.name)
      const sessions: string[] = []
      let projectId: string | null = null
      let restore: (() => Promise<void>) | undefined
      try {
        restore = await provider.preserve?.()
        // A project needs a root commit for its repository identity.
        await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
        const worktree = await registerFixtureProject(page, orchestration, fixture)
        projectId = worktree.projectId
        const run = async (label: string) => {
          const sessionId = crypto.randomUUID()
          sessions.push(sessionId)
          await startSession(page, provider, orchestration, worktree.id, sessionId, label)
        }

        await run('ask')
        await selectors.commandApproval(page).waitFor({ timeout: 90_000 })
        const labels = await selectors
          .commandApproval(page)
          .getByRole('button')
          .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ''))
        strictEqual(labels.length, provider.options.length, `options were ${labels.join(', ')}`)
        provider.options.forEach((expected, index) =>
          ok(matches(labels[index] ?? '', expected), `option ${index} was ${labels[index]}`),
        )
        await step('command-approval')

        await selectors.commandApprovalDecision(page, provider.always).click()
        await selectors.commandApproval(page).waitFor({ state: 'hidden', timeout: 30_000 })
        await waitForReply(page)
        await access(path.join(fixture, MARKER))
        await provider.ruleWritten(fixture)
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
        await restore?.()
      }
    },
  }
}

export const claudeApprovalRules = approvalRulesScenario({
  name: 'claude-approval-rules',
  description:
    'Real Claude (Haiku) in approval-required mode: the command approval offers session and always rules, "Always allow in this project" writes settings.local.json, and a new session runs the same command without asking. Removes the fixture, sessions and project.',
  model: { providerInstanceId: 'claude', model: 'claude-haiku-4-5' },
  prompt: `Use the Bash tool to run exactly \`touch ${MARKER}\`. Use no other tool. Then reply with exactly ${DONE}.`,
  options: [
    'Cancel',
    'Deny',
    'Allow for this session',
    'Always allow in this project',
    'Always allow everywhere',
    'Allow',
  ],
  always: 'Always allow in this project',
  async ruleWritten(fixture) {
    const settings = await readFile(path.join(fixture, '.claude', 'settings.local.json'), 'utf8')
    ok(settings.includes(`Bash(touch ${MARKER})`), 'settings.local.json must hold the Bash rule')
  },
})

export const codexApprovalRules = approvalRulesScenario({
  name: 'codex-approval-rules',
  description:
    'Real Codex in approval-required mode: the command approval offers the proposed execpolicy amendment, choosing it writes ~/.codex/rules/default.rules, and a new session runs the same command without asking. Restores the rules file byte for byte and removes the fixture, sessions and project.',
  model: { providerInstanceId: 'codex', model: 'gpt-5.5' },
  prompt: `Run exactly \`touch ${MARKER}\` in the workspace, once, and run nothing else. Then reply with exactly ${DONE}.`,
  // What codex 0.156.1 lists in availableDecisions for a plain command.
  options: ['Cancel', ALWAYS_TOUCH, 'Allow'],
  always: ALWAYS_TOUCH,
  async ruleWritten() {
    const rules = await readFile(CODEX_RULES, 'utf8')
    ok(/prefix_rule\(pattern=\["touch"/.test(rules), 'default.rules must hold the touch rule')
  },
  async preserve() {
    const before = await readFile(CODEX_RULES, 'utf8').catch(nullWhenMissing)
    return async () => {
      // A file the run created is removed, not left holding the rule.
      if (before === null) {
        await rm(CODEX_RULES, { force: true })
        return
      }
      await writeFile(CODEX_RULES, before)
      strictEqual(await readFile(CODEX_RULES, 'utf8'), before)
    }
  },
})

function nullWhenMissing(error: unknown) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
  throw error
}

function matches(label: string, expected: string | RegExp) {
  return typeof expected === 'string' ? label === expected : expected.test(label)
}

async function startSession(
  page: Page,
  provider: ApprovalRulesProvider,
  orchestration: string,
  worktreeId: string,
  sessionId: string,
  label: string,
) {
  const title = `${provider.name} ${label} ${sessionId.slice(0, 8)}`
  await dispatch(page, orchestration, {
    type: 'session.create',
    sessionId,
    title,
    worktreeTarget: { kind: 'current', worktreeId },
    modelSelection: provider.model,
    runtimeMode: 'approval-required',
  })
  await selectors.sessionSearch(page).fill(title)
  await selectors.sessionByTitle(page, title).click()
  await page.waitForURL((url) => url.href.includes(sessionId))
  await typePrompt(page, provider.prompt)
  await selectors.chatSend(page).click()
}

// The prompt itself contains the word, so the reply is the second match.
async function waitForReply(page: Page) {
  const matches = selectors.chatMessages(page).getByText(DONE)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if ((await matches.count()) >= 2) return
    await Bun.sleep(250)
  }
  ok(false, `The agent never replied ${DONE}`)
}

// The composer re-mounts once the session loads, which drops text typed before it.
async function typePrompt(page: Page, prompt: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await selectors.chatMessage(page).fill(prompt)
    await Bun.sleep(300)
    if (await selectors.chatSend(page).isEnabled()) return
  }
  ok(false, 'The composer never accepted the prompt')
}
