import { TEST_WORKTREE_ID } from '../../../../../test/factories/chat'
import {
  DEFAULT_PROVIDER_INSTANCE_ID,
  proposedPlanIdSchema,
  type OrchestrationProposedPlan,
} from '@workspace/contracts'
import * as v from 'valibot'

import { createDraftSessionSubmission } from '@workspace/client-core/chat/commands'
import {
  actionableProposedPlan,
  planImplementationPrompt,
  planImplementationSessionTitle,
  proposedPlanExportFilename,
  proposedPlanExportMarkdown,
  resolvePlanFollowUpSubmission,
} from '@workspace/client-core/chat/proposed-plan'
import { expect, test } from '../../../../../test/fixtures'

const PLAN_MARKDOWN = '# Ship the retry queue\n\n1. Add the queue\n2. Drain it on boot\n'

test('an empty composer resolves to implementing the plan as written', () => {
  const submission = resolvePlanFollowUpSubmission({
    draftText: '   \n ',
    planMarkdown: PLAN_MARKDOWN,
  })

  expect(submission).toEqual({
    implementsPlan: true,
    interactionMode: 'default',
    text: planImplementationPrompt(PLAN_MARKDOWN),
  })
  expect(submission.text).toContain('Drain it on boot')
})

test('typed feedback resolves to another planning turn, not an implementation', () => {
  const submission = resolvePlanFollowUpSubmission({
    draftText: '  drop step 2  ',
    planMarkdown: PLAN_MARKDOWN,
  })

  expect(submission).toEqual({
    implementsPlan: false,
    interactionMode: 'plan',
    text: 'drop step 2',
  })
})

test('the newest plan nothing was built from is the actionable one', () => {
  const plans = [
    plan({ id: planId('plan-1'), updatedAt: '2026-05-28T00:00:01.000Z' }),
    plan({ id: planId('plan-2') }),
  ]

  expect(actionableProposedPlan(plans)?.id).toBe('plan-2')
})

test('an implemented plan is never actionable again', () => {
  const plans = [plan({ id: planId('plan-1'), implementedAt: '2026-05-28T00:00:03.000Z' })]

  expect(actionableProposedPlan(plans)).toBeNull()
})

test('an older plan stays superseded after the newer plan was implemented', () => {
  const plans = [
    plan({ id: planId('plan-1'), updatedAt: '2026-05-28T00:00:01.000Z' }),
    plan({
      id: planId('plan-2'),
      implementedAt: '2026-05-28T00:00:09.000Z',
      updatedAt: '2026-05-28T00:00:05.000Z',
    }),
  ]

  expect(actionableProposedPlan(plans)).toBeNull()
})

test('the export keeps the heading the card strips and ends in a newline', () => {
  const exported = proposedPlanExportMarkdown('# Ship the retry queue\n\nStep one   ')

  expect(exported).toBe('# Ship the retry queue\n\nStep one\n')
})

test('the export filename is the plan title as a markdown slug', () => {
  expect(proposedPlanExportFilename(PLAN_MARKDOWN)).toBe('ship-the-retry-queue.md')
})

test('a title with no usable characters still produces a filename', () => {
  expect(proposedPlanExportFilename('# ***\n\nbody')).toBe('plan.md')
})

test('a session split off to build a plan is named after the plan', () => {
  expect(planImplementationSessionTitle(PLAN_MARKDOWN)).toBe('Implement Ship the retry queue')
})

test('a plan with no heading still names its session something a rail row can read', () => {
  expect(planImplementationSessionTitle('- step one\n- step two')).toBe('Implement plan')
})

test('a heading long enough to fill the rail is cut down like any other title', () => {
  const title = planImplementationSessionTitle(`# ${'retry queue '.repeat(10)}`)

  expect(title.startsWith('Implement retry queue')).toBe(true)
  expect(title.endsWith('…')).toBe(true)
})

test('a heading that reads like a secret never becomes a session title', () => {
  expect(planImplementationSessionTitle('# rotate the openai api key')).toBe('Implement plan')
})

test('the new session carries the plan title instead of the implementation header', () => {
  const command = draftCommand()

  // The prompt's first line is the instruction carrying the plan, so the
  // derived title would read "Please implement this plan" without the override.
  expect(command.bootstrap?.createSession?.title).toBe('Implement Ship the retry queue')
  expect(command.titleSeed).toBe('Implement Ship the retry queue')
})

test('the new session points back at the plan it was split off to build', () => {
  expect(draftCommand().sourceProposedPlan).toEqual({
    planId: 'plan-1',
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
  })
})

test('the new session keeps the project and the prompt the draft builder chose', () => {
  const command = draftCommand()

  expect(command.bootstrap?.createSession?.worktreeTarget.worktreeId).toBe(TEST_WORKTREE_ID)
  // Session creation and the first turn are one command, so a rejected dispatch
  // leaves no session behind to clean up.
  expect(command.bootstrap?.createSession).toBeDefined()
  expect(command.message.text).toContain('Drain it on boot')
})

function draftCommand() {
  return createDraftSessionSubmission({
    createdAt: '2026-05-28T00:00:02.000Z',
    modelSelection: {
      model: 'claude-opus-5',
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    },
    worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
    sourceProposedPlan: {
      planId: planId('plan-1'),
      sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb' as OrchestrationProposedPlan['sessionId'],
    },
    text: planImplementationPrompt(PLAN_MARKDOWN),
    title: planImplementationSessionTitle(PLAN_MARKDOWN),
  }).command
}

function plan(overrides: Partial<OrchestrationProposedPlan> = {}): OrchestrationProposedPlan {
  return {
    createdAt: '2026-05-28T00:00:02.000Z',
    id: planId('plan-1'),
    implementationSessionId: null,
    implementedAt: null,
    planMarkdown: PLAN_MARKDOWN,
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    turnId: 'turn-1',
    updatedAt: '2026-05-28T00:00:02.000Z',
    ...overrides,
  } as OrchestrationProposedPlan
}

function planId(value: string) {
  return v.parse(proposedPlanIdSchema, value)
}
