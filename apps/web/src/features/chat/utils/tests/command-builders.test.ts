import { TEST_PROJECT_ID, TEST_WORKTREE_ID } from '../../../../../test/factories/chat'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  projectMetaUpdateCommandSchema,
  sessionIdSchema,
  type ModelSelection,
} from '@workspace/contracts'
import * as v from 'valibot'

import {
  createDraftSessionSubmission,
  createCheckpointRevertCommand,
  createProjectDefaultModelCommand,
  createProjectMetaCommand,
  createProjectScriptsCommand,
  createSessionInterruptCommand,
  createTurnSubmission,
  createWorkspaceProjectCommand,
  sessionTitleFromPrompt,
  workspaceProjectTitle,
} from '@workspace/client-core/chat/commands'

const testModelSelection: ModelSelection = {
  model: 'claude-opus-5',
  providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
}

describe('chat command builders', () => {
  it('registers a checkout without inventing authoritative identifiers', () => {
    const rootPath = '/Users/test/workspace/platform'
    const command = createWorkspaceProjectCommand({ rootPath })

    expect(command).not.toHaveProperty('projectId')
    expect(command).not.toHaveProperty('worktreeId')
    expect(command.title).toBe('platform')
    expect(command.workspaceRoot).toBe(rootPath)
    // No invented default: the model is resolved from live providers at compose time.
    expect(command.defaultModelSelection).toBeNull()
  })

  it('builds a project default-model update that touches nothing else', () => {
    const projectId = TEST_PROJECT_ID
    const command = createProjectDefaultModelCommand({
      defaultModelSelection: testModelSelection,
      projectId,
    })

    expect(v.parse(projectMetaUpdateCommandSchema, command)).toMatchObject({
      defaultModelSelection: testModelSelection,
      projectId,
      type: 'project.meta.update',
    })
    expect(command).not.toHaveProperty('title')
    expect(command).not.toHaveProperty('workspaceRoot')
  })

  it('builds a turn command and matching optimistic user message', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const modelSelection: ModelSelection = {
      model: 'codex-test',
      providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
    }
    const submission = createTurnSubmission({
      attachments: [
        {
          id: 'image-1',
          mimeType: 'image/png',
          name: 'screenshot.png',
          sizeBytes: 12,
          type: 'image',
        },
      ],
      createdAt: '2026-05-24T12:00:00.000Z',
      interactionMode: DEFAULT_INTERACTION_MODE,
      modelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      text: 'Explain the workspace',
      sessionId,
    })

    expect(submission.command.type).toBe('session.turn.start')
    expect(submission.command.message.messageId).toBe(submission.optimisticMessage.id)
    expect(submission.optimisticMessage.turnId).toBe(submission.command.turnId)
    expect(submission.optimisticMessage.text).toBe('Explain the workspace')
    expect(submission.command.message.attachments).toEqual(submission.optimisticMessage.attachments)
  })

  it('builds a draft session turn with bootstrap create-session metadata', () => {
    const submission = createDraftSessionSubmission({
      createdAt: '2026-05-24T12:00:00.000Z',
      modelSelection: testModelSelection,
      worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
      text: 'Fix the draft session flow',
    })

    expect(submission.command.type).toBe('session.turn.start')
    expect(submission.command.bootstrap?.createSession).toMatchObject({
      worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
      title: 'Fix the draft session flow',
    })
    expect(submission.command.message.messageId).toBe(submission.optimisticMessage.id)
    expect(submission.command.sessionId).toBe(submission.optimisticMessage.sessionId)
  })

  it('does not derive session titles from secret-bearing prompts', () => {
    const draft = createDraftSessionSubmission({
      createdAt: '2026-05-24T12:00:00.000Z',
      modelSelection: testModelSelection,
      worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
      text: 'Rotate the API key in staging',
    })
    const turn = createTurnSubmission({
      createdAt: '2026-05-24T12:00:00.000Z',
      interactionMode: DEFAULT_INTERACTION_MODE,
      modelSelection: {
        model: 'codex-test',
        providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
      },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      text: 'The password is hunter2',
      sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    })

    expect(sessionTitleFromPrompt('Fix tokenizer tests')).toBe('Fix tokenizer tests')
    expect(sessionTitleFromPrompt('The access_key is abc123')).toBeUndefined()
    expect(draft.command.bootstrap?.createSession?.title).toBe('New chat')
    expect(draft.command.titleSeed).toBe('New chat')
    expect(turn.command.titleSeed).toBeUndefined()
  })

  it('appends captured terminal output after the prompt without renaming the session', () => {
    const terminalContexts = [
      { lineEnd: 812, lineStart: 810, source: 'terminal-1', text: 'make: *** [build] Error 1' },
    ]
    const turn = createTurnSubmission({
      createdAt: '2026-05-24T12:00:00.000Z',
      interactionMode: DEFAULT_INTERACTION_MODE,
      modelSelection: testModelSelection,
      runtimeMode: DEFAULT_RUNTIME_MODE,
      terminalContexts,
      text: 'Why is this failing?',
      sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    })
    const draft = createDraftSessionSubmission({
      createdAt: '2026-05-24T12:00:00.000Z',
      modelSelection: testModelSelection,
      worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
      terminalContexts,
      // Nothing typed: the title must not fall back to the attached markup.
      text: '',
    })

    expect(turn.command.message.text).toBe(
      'Why is this failing?\n\n<terminal_context>\n<selection source="terminal-1" lines="810-812">\nmake: *** [build] Error 1\n</selection>\n</terminal_context>',
    )
    expect(turn.command.message.text).toBe(turn.optimisticMessage.text)
    expect(turn.command.titleSeed).toBe('Why is this failing?')
    expect(draft.command.bootstrap?.createSession?.title).toBe('New chat')
    expect(draft.command.message.text).toContain('<terminal_context>')
  })

  it('keeps interrupt commands scoped to the active session and turn', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const command = createSessionInterruptCommand({ sessionId })

    expect(command.type).toBe('session.turn.interrupt')
    expect(command.sessionId).toBe(sessionId)
    expect(command.turnId).toBeUndefined()
  })

  it('builds checkpoint revert commands for user-row rollback affordances', () => {
    const sessionId = v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb')
    const command = createCheckpointRevertCommand({
      sessionId,
      turnCount: 2,
    })

    expect(command).toMatchObject({
      sessionId,
      turnCount: 2,
      type: 'session.checkpoint.revert',
    })
  })

  it('formats workspace and prompt titles for compact sidebar use', () => {
    expect(workspaceProjectTitle('/Users/test/workspace/platform/')).toBe('platform')
    expect(sessionTitleFromPrompt('  Fix the failing chat projection tests  ')).toBe(
      'Fix the failing chat projection tests',
    )
    expect(sessionTitleFromPrompt('x'.repeat(80))).toHaveLength(48)
  })

  it('a project rename names only the field it changes', () => {
    const projectId = TEST_PROJECT_ID
    const command = createProjectMetaCommand({ projectId, title: 'Renamed' })

    // The projection patches compactly, so an absent key means "leave it alone".
    // Sending `workspaceRoot: undefined` explicitly would be the same object to
    // JSON but a different one to Valibot's `v.optional`, and repointing a
    // project at `undefined` is not what a rename means.
    expect(command).toEqual({
      commandId: expect.any(String),
      projectId,
      title: 'Renamed',
      type: 'project.meta.update',
    })
    expect('workspaceRoot' in command).toBe(false)
    expect('scripts' in command).toBe(false)
  })

  it('saved scripts are written as a whole list, empty included', () => {
    const cleared = createProjectScriptsCommand({
      projectId: TEST_PROJECT_ID,
      scripts: [],
    })

    // Empty is a real value the user chose — it is how the list is cleared — so
    // it must survive as `[]` rather than being dropped as "nothing to say".
    expect(cleared.scripts).toEqual([])
    expect('title' in cleared).toBe(false)
  })
})
