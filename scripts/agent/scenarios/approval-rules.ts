import { ok, strictEqual } from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { dispatch, typePrompt, waitForReply } from './chat-verification'
import { runInFixtureRepository, type FixtureRepository } from './fixture-repository'
import type { FixtureProviderKind } from './native-provider-verification'

const MARKER = 'marker-145.txt'
const DONE = 'APPROVAL_RULE_HELD'
const ALWAYS_TOUCH = /^Always allow commands starting with touch/

type ApprovalRulesProvider = {
  readonly name: string
  readonly description: string
  readonly kind: FixtureProviderKind
  readonly prompt: string
  /** The options the command approval must offer, in order. */
  readonly options: readonly (string | RegExp)[]
  readonly always: string | RegExp
  /** Checks the rule landed in the harness's own store. */
  readonly ruleWritten: (repository: FixtureRepository) => Promise<void>
}

/**
 * A fixture provider in a disposable repository: the command approval offers the rule the
 * harness proposes, choosing it writes the harness's own rule store, and a second session
 * runs the same command without asking. The fixture writes the rule only from the decision
 * Platform sends, and reads it back the way the harness does.
 */
function approvalRulesScenario(provider: ApprovalRulesProvider): Scenario {
  return {
    name: provider.name,
    requiresIsolatedServer: true,
    description: provider.description,
    run: (page, { step }) =>
      runInFixtureRepository(page, step, provider, async (repository) => {
        await startSession(page, provider, repository, 'ask')
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
        await waitForReply(page, DONE)
        await access(path.join(repository.fixture, MARKER))
        await provider.ruleWritten(repository)
        await step('rule-written')

        await startSession(page, provider, repository, 'remembered')
        await waitForReply(page, DONE)
        strictEqual(await selectors.commandApproval(page).count(), 0)
        await step('second-session-not-asked')
      }),
  }
}

export const claudeApprovalRules = approvalRulesScenario({
  name: 'claude-approval-rules',
  description:
    'The Claude fixture in approval-required mode: the command approval offers session and always rules from the permission suggestions, "Always allow in this project" writes settings.local.json, and a new session runs the same command without asking. Removes the fixture, sessions and project.',
  kind: 'claude',
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
  async ruleWritten({ fixture }) {
    const settings = await readFile(path.join(fixture, '.claude', 'settings.local.json'), 'utf8')
    ok(settings.includes(`Bash(touch ${MARKER})`), 'settings.local.json must hold the Bash rule')
  },
})

export const codexApprovalRules = approvalRulesScenario({
  name: 'codex-approval-rules',
  description:
    "The Codex fixture in approval-required mode: the command approval offers the proposed execpolicy amendment, choosing it writes rules/default.rules in the fixture's own CODEX_HOME, and a new session runs the same command without asking. Removes the fixture, sessions, project and Codex home.",
  kind: 'codex',
  prompt: `Run exactly \`touch ${MARKER}\` in the workspace, once, and run nothing else. Then reply with exactly ${DONE}.`,
  // What codex 0.156.1 lists in availableDecisions for a plain command.
  options: ['Cancel', ALWAYS_TOUCH, 'Allow'],
  always: ALWAYS_TOUCH,
  async ruleWritten({ native }) {
    const rules = await readFile(path.join(native.root, 'rules', 'default.rules'), 'utf8')
    ok(/prefix_rule\(pattern=\["touch"/.test(rules), 'default.rules must hold the touch rule')
  },
})

function matches(label: string, expected: string | RegExp) {
  return typeof expected === 'string' ? label === expected : expected.test(label)
}

async function startSession(
  page: Page,
  provider: ApprovalRulesProvider,
  repository: FixtureRepository,
  label: string,
) {
  const sessionId = crypto.randomUUID()
  repository.sessions.push(sessionId)
  const title = `${provider.name} ${label} ${sessionId.slice(0, 8)}`
  await dispatch(page, repository.orchestration, {
    type: 'session.create',
    sessionId,
    title,
    worktreeTarget: { kind: 'current', worktreeId: repository.worktreeId },
    modelSelection: repository.native.model,
    runtimeMode: 'approval-required',
  })
  await selectors.sessionSearch(page).fill(title)
  await selectors.sessionByTitle(page, title).click()
  await page.waitForURL((url) => url.href.includes(sessionId))
  await typePrompt(page, provider.prompt)
  await selectors.chatSend(page).click()
}
