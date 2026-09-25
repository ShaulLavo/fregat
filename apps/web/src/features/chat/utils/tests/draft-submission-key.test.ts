import { environmentIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { expect, test } from '../../../../../test/fixtures'
import {
  TEST_ENVIRONMENT_ID,
  TEST_WORKTREE_ID,
  sessionShell,
} from '../../../../../test/factories/chat'
import { draftSubmissionKey } from '../draft-submission-key'

const input: Parameters<typeof draftSubmissionKey>[0] = {
  environmentId: TEST_ENVIRONMENT_ID,
  fanOut: false,
  worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
  payload: {
    text: 'Ship it',
    modelSelection: sessionShell().modelSelection,
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    attachments: [],
    terminalContexts: [],
  },
}

test('identical complete submissions reuse their command key', () => {
  expect(draftSubmissionKey(structuredClone(input))).toBe(draftSubmissionKey(input))
})

test.each([
  { runtimeMode: 'full-access' },
  { interactionMode: 'plan' },
  {
    attachments: [
      {
        type: 'file',
        id: 'replacement',
        name: 'notes.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
      },
    ],
  },
  { terminalContexts: [{ source: 'terminal-1', text: 'new context', lineStart: 1, lineEnd: 1 }] },
] satisfies Partial<typeof input.payload>[])(
  'changed submission content gets a fresh command: %j',
  (change) => {
    expect(draftSubmissionKey({ ...input, payload: { ...input.payload, ...change } })).not.toBe(
      draftSubmissionKey(input),
    )
  },
)

test('changing destination, environment or fan-out gets a fresh command', () => {
  expect(
    draftSubmissionKey({
      ...input,
      worktreeTarget: {
        kind: 'new',
        worktreeId: TEST_WORKTREE_ID,
        baseWorktreeId: TEST_WORKTREE_ID,
        baseBranch: 'release',
      },
    }),
  ).not.toBe(draftSubmissionKey(input))
  expect(
    draftSubmissionKey({
      ...input,
      environmentId: v.parse(environmentIdSchema, '00000000-0000-4000-8000-000000000009'),
    }),
  ).not.toBe(draftSubmissionKey(input))
  expect(draftSubmissionKey({ ...input, fanOut: true })).not.toBe(draftSubmissionKey(input))
})
