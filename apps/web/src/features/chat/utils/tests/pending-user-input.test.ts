import type { OrchestrationSessionActivity, UserInputQuestion } from '@workspace/contracts'

import {
  buildUserInputAnswers,
  derivePendingUserInputs,
  firstUnansweredUserInputIndex,
  isUserInputDraftComplete,
  resolveUserInputAnswer,
  setUserInputCustomAnswer,
  toggleUserInputOption,
} from '@workspace/client-core/chat/pending-user-input'
import { expect, test } from '../../../../../test/fixtures'

const scope: UserInputQuestion = {
  allowOther: false,
  answerKind: 'single-select',
  header: 'Scope',
  id: 'scope',
  options: [
    { description: 'Start with orchestration', label: 'Orchestration', value: 'orchestration' },
    { description: 'Start with the panel', label: 'Panel', value: 'panel' },
  ],
  prompt: 'What should the plan target first?',
  secret: false,
}

const areas: UserInputQuestion = {
  allowOther: false,
  answerKind: 'multi-select',
  header: 'Areas',
  id: 'areas',
  options: [
    { description: 'Server code', label: 'Server', value: 'server' },
    { description: 'Web code', label: 'Web', value: 'web' },
  ],
  prompt: 'Which areas should this change cover?',
  secret: false,
}

const notes: UserInputQuestion = {
  allowOther: false,
  answerKind: 'text',
  header: 'Notes',
  id: 'notes',
  options: [],
  prompt: 'Anything else the agent should know?',
  secret: false,
}

test('an unresolved request stays open and a resolved one drops out', () => {
  const pending = derivePendingUserInputs([
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-1', sequence: 1 }),
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-2', sequence: 2 }),
    userInputActivity({ kind: 'user-input.resolved', requestId: 'req-1', sequence: 3 }),
  ])

  expect(pending.map((input) => input.requestId)).toEqual(['req-2'])
})

test('a resolve that arrives before its request in the array still closes it', () => {
  const pending = derivePendingUserInputs([
    userInputActivity({ kind: 'user-input.resolved', requestId: 'req-1', sequence: 2 }),
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-1', sequence: 1 }),
  ])

  expect(pending).toEqual([])
})

test('open requests come back oldest first', () => {
  const pending = derivePendingUserInputs([
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-late', sequence: 3 }),
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-early', sequence: 1 }),
  ])

  expect(pending.map((input) => input.requestId)).toEqual(['req-early', 'req-late'])
})

test('the derived request carries its questions and turn', () => {
  const [pending] = derivePendingUserInputs([
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-1', sequence: 1 }),
  ])

  expect(pending?.questions).toEqual([scope, areas])
  expect(pending?.turnId).toBe('turn-1')
})

test('malformed payloads are dropped instead of breaking the derivation', () => {
  const pending = derivePendingUserInputs([
    activity({ createdAt: at(1), kind: 'user-input.requested', payload: null }),
    activity({ createdAt: at(2), kind: 'user-input.requested', payload: { questions: [scope] } }),
    activity({
      createdAt: at(3),
      kind: 'user-input.requested',
      payload: { questions: 'nope', requestId: 'req-bad-questions' },
    }),
    userInputActivity({ kind: 'user-input.requested', requestId: 'req-good', sequence: 4 }),
  ])

  expect(pending.map((input) => input.requestId)).toEqual(['req-good'])
})

test('an unreadable question is dropped without losing its siblings', () => {
  const [pending] = derivePendingUserInputs([
    activity({
      createdAt: at(1),
      kind: 'user-input.requested',
      payload: { questions: [{ id: 'no-prompt' }, scope], requestId: 'req-1' },
    }),
  ])

  expect(pending?.questions).toEqual([scope])
})

test('a request with no readable question at all is dropped', () => {
  const pending = derivePendingUserInputs([
    activity({
      createdAt: at(1),
      kind: 'user-input.requested',
      payload: { questions: [{ id: 'no-prompt' }], requestId: 'req-1' },
    }),
  ])

  expect(pending).toEqual([])
})

test('an unanswered question resolves to null', () => {
  expect(resolveUserInputAnswer(scope, undefined)).toBeNull()
  expect(resolveUserInputAnswer(areas, { selectedValues: [] })).toBeNull()
  expect(resolveUserInputAnswer(notes, { customAnswer: '   ' })).toBeNull()
})

test('a single-select resolves to the picked value', () => {
  expect(resolveUserInputAnswer(scope, { selectedValues: ['panel'] })).toBe('panel')
})

test('a multi-select resolves to every picked value', () => {
  expect(resolveUserInputAnswer(areas, { selectedValues: ['server', 'web'] })).toEqual([
    'server',
    'web',
  ])
})

test('a text question ignores stray selections and answers with the typed text', () => {
  expect(resolveUserInputAnswer(notes, { customAnswer: ' ship it ', selectedValues: ['x'] })).toBe(
    'ship it',
  )
})

test('typed text is ignored on a select that does not allow an other answer', () => {
  expect(resolveUserInputAnswer(scope, { customAnswer: 'something else' })).toBeNull()
  expect(
    resolveUserInputAnswer(scope, { customAnswer: 'something else', selectedValues: ['panel'] }),
  ).toBe('panel')
})

test('an allowOther single-select prefers the typed text over the picked value', () => {
  const question = { ...scope, allowOther: true }

  expect(
    resolveUserInputAnswer(question, { customAnswer: 'Neither', selectedValues: ['panel'] }),
  ).toBe('Neither')
})

test('an allowOther multi-select carries the typed text as one more value', () => {
  const question = { ...areas, allowOther: true }

  expect(
    resolveUserInputAnswer(question, { customAnswer: 'Docs', selectedValues: ['server'] }),
  ).toEqual(['server', 'Docs'])
})

test('toggling a multi-select adds then removes a value', () => {
  const added = toggleUserInputOption(areas, undefined, 'server')
  expect(added.selectedValues).toEqual(['server'])

  const both = toggleUserInputOption(areas, added, 'web')
  expect(both.selectedValues).toEqual(['server', 'web'])

  const removed = toggleUserInputOption(areas, both, 'server')
  expect(removed.selectedValues).toEqual(['web'])
})

test('toggling a single-select replaces the pick', () => {
  const first = toggleUserInputOption(scope, undefined, 'orchestration')
  const second = toggleUserInputOption(scope, first, 'panel')

  expect(second.selectedValues).toEqual(['panel'])
})

test('picking a single-select value clears the other text so the click wins', () => {
  const question = { ...scope, allowOther: true }
  const next = toggleUserInputOption(question, { customAnswer: 'typed earlier' }, 'panel')

  expect(resolveUserInputAnswer(question, next)).toBe('panel')
})

test('picking a multi-select value keeps the other text alongside it', () => {
  const question = { ...areas, allowOther: true }
  const next = toggleUserInputOption(question, { customAnswer: 'Docs' }, 'server')

  expect(resolveUserInputAnswer(question, next)).toEqual(['server', 'Docs'])
})

test('typing an other answer keeps the picks and clearing it brings them back', () => {
  const question = { ...scope, allowOther: true }
  const picked = toggleUserInputOption(question, undefined, 'panel')

  const typed = setUserInputCustomAnswer(picked, 'Something else')
  expect(resolveUserInputAnswer(question, typed)).toBe('Something else')

  const cleared = setUserInputCustomAnswer(typed, '')
  expect(resolveUserInputAnswer(question, cleared)).toBe('panel')
})

test('the first unanswered question is where the panel should sit', () => {
  expect(firstUnansweredUserInputIndex([scope, areas], {})).toBe(0)
  expect(
    firstUnansweredUserInputIndex([scope, areas], { scope: { selectedValues: ['panel'] } }),
  ).toBe(1)
})

test('a fully answered set parks on the last question', () => {
  const drafts = {
    areas: { selectedValues: ['server'] },
    scope: { selectedValues: ['panel'] },
  }

  expect(firstUnansweredUserInputIndex([scope, areas], drafts)).toBe(1)
})

test('an empty question set parks on index 0', () => {
  expect(firstUnansweredUserInputIndex([], {})).toBe(0)
})

test('a partial draft is neither complete nor submittable', () => {
  const drafts = { scope: { selectedValues: ['panel'] } }

  expect(isUserInputDraftComplete([scope, areas], drafts)).toBe(false)
  expect(buildUserInputAnswers([scope, areas], drafts)).toBeNull()
})

test('a complete draft builds the answers record keyed by question id', () => {
  const drafts = {
    areas: { selectedValues: ['server', 'web'] },
    notes: { customAnswer: 'Prefer small commits' },
    scope: { selectedValues: ['panel'] },
  }

  expect(isUserInputDraftComplete([scope, areas, notes], drafts)).toBe(true)
  expect(buildUserInputAnswers([scope, areas, notes], drafts)).toEqual({
    areas: ['server', 'web'],
    notes: 'Prefer small commits',
    scope: 'panel',
  })
})

function at(index: number) {
  return `2026-05-28T00:00:0${index}.000Z`
}

function userInputActivity({
  kind,
  requestId,
  sequence,
}: {
  kind: string
  requestId: string
  sequence: number
}) {
  return activity({
    createdAt: at(sequence),
    kind,
    payload: { questions: [scope, areas], requestId },
    sequence,
    turnId: 'turn-1',
  })
}

function activity({
  createdAt,
  kind,
  payload,
  sequence,
  turnId = null,
}: {
  createdAt: string
  kind: string
  payload: unknown
  sequence?: number
  turnId?: string | null
}): OrchestrationSessionActivity {
  return {
    createdAt,
    id: `event-${kind}-${createdAt}-${sequence ?? 'none'}`,
    kind,
    payload,
    sequence,
    summary: kind,
    sessionId: 'ad686244-5b2e-59be-805f-ef86eac80feb',
    tone: 'info',
    turnId,
  } as OrchestrationSessionActivity
}
