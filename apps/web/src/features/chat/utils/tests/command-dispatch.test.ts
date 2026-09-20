import { TEST_WORKTREE_ID } from '../../../../../test/factories/chat'
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_PROVIDER_INSTANCE_ID,
  DEFAULT_RUNTIME_MODE,
  sessionIdSchema,
  type ClientOrchestrationCommand,
} from '@workspace/contracts'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import {
  createCheckpointRevertCommand,
  createDraftSessionSubmission,
  createTurnSubmission,
} from '@workspace/client-core/chat/commands'
import { dispatchChatCommand, replayAfterDispatch } from '@/features/chat/utils/command-dispatch'

const MODEL_SELECTION = {
  model: 'codex-test',
  providerInstanceId: DEFAULT_PROVIDER_INSTANCE_ID,
}

describe('dispatchChatCommand', () => {
  it('an accepted dispatch returns the server result', async () => {
    const outcome = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => ({ result: null, deduped: false, sequence: 12 }),
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.ok && outcome.result.sequence).toBe(12)
  })

  it('a refused dispatch returns the error and its message', async () => {
    const refusal = new Error('socket closed')
    const outcome = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => {
        throw refusal
      },
    })

    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.message).toBe('socket closed')
    expect(!outcome.ok && outcome.error).toBe(refusal)
  })

  it('a non-Error rejection falls back to the generic message', async () => {
    const fromString = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => {
        throw 'nope'
      },
    })
    const fromObject = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => {
        throw {}
      },
    })

    expect(!fromString.ok && fromString.message).toBe('nope')
    expect(!fromObject.ok && fromObject.message).toBe('Chat command failed.')
  })

  it('onFailed runs on refusal and not on acceptance', async () => {
    let accepted = 0
    let failed = 0

    await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => ({ result: null, deduped: false, sequence: 3 }),
      onAccepted: () => {
        accepted += 1
      },
      onFailed: () => {
        failed += 1
      },
    })
    expect([accepted, failed]).toEqual([1, 0])

    await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => {
        throw new Error('refused')
      },
      onAccepted: () => {
        accepted += 1
      },
      onFailed: () => {
        failed += 1
      },
    })
    expect([accepted, failed]).toEqual([1, 1])
  })

  it('a throwing onAccepted does not turn an accepted dispatch into a failure', async () => {
    const outcome = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => ({ result: null, deduped: false, sequence: 4 }),
      onAccepted: () => {
        throw new Error('host blew up')
      },
    })

    expect(outcome.ok).toBe(true)
  })

  it('a throwing onFailed does not escape', async () => {
    const outcome = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      command: turnCommand(),
      dispatchCommand: async () => {
        throw new Error('refused')
      },
      onFailed: () => {
        throw new Error('rollback blew up')
      },
    })

    expect(outcome.ok).toBe(false)
  })

  it('a throwing beforeDispatch never sends the command', async () => {
    let dispatched = 0
    const outcome = await dispatchChatCommand({
      action: 'chat.test.dispatch.summary',
      beforeDispatch: () => {
        throw new Error('optimistic write blew up')
      },
      command: turnCommand(),
      dispatchCommand: async () => {
        dispatched += 1

        return { result: null, deduped: false, sequence: 1 }
      },
    })

    expect(outcome.ok).toBe(false)
    expect(dispatched).toBe(0)
  })

  it('derives the replay window from the command shape', () => {
    expect(replayAfterDispatch(turnCommand(), { result: null, deduped: false, sequence: 12 })).toBe(
      10,
    )
    expect(
      replayAfterDispatch(draftCommand(), { result: null, deduped: false, sequence: 12 }),
    ).toBe(9)
    expect(
      replayAfterDispatch(checkpointRevertCommand(), {
        result: null,
        deduped: false,
        sequence: 12,
      }),
    ).toBe(10)
    expect(replayAfterDispatch(turnCommand(), { result: null, deduped: false, sequence: 1 })).toBe(
      0,
    )
  })
})

function turnCommand(): ClientOrchestrationCommand {
  return createTurnSubmission({
    createdAt: '2026-05-28T00:00:00.000Z',
    interactionMode: DEFAULT_INTERACTION_MODE,
    modelSelection: MODEL_SELECTION,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    text: 'Hello',
    sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
  }).command
}

function draftCommand(): ClientOrchestrationCommand {
  return createDraftSessionSubmission({
    createdAt: '2026-05-28T00:00:00.000Z',
    modelSelection: MODEL_SELECTION,
    worktreeTarget: { kind: 'current', worktreeId: TEST_WORKTREE_ID },
    text: 'Hello',
  }).command
}

function checkpointRevertCommand(): ClientOrchestrationCommand {
  return createCheckpointRevertCommand({
    restoreFiles: false,
    sessionId: v.parse(sessionIdSchema, 'ad686244-5b2e-59be-805f-ef86eac80feb'),
    turnCount: 2,
  })
}
