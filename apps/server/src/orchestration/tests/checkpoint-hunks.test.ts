import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import * as v from 'valibot'
import { commandIdSchema, messageIdSchema, turnIdSchema } from '@workspace/contracts'

import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
import { OrchestrationCheckpointHunks } from '../checkpoint-hunks'
import { checkpointRefForSessionTurn } from '../checkpoint-refs'
import {
  checkpointOrchestration,
  checkpointRepository,
  checkpointSessionId as sessionId,
  dispatchCheckpointSession,
  runGit,
} from '../../../test/factories/checkpoint-session'

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

const before = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`)
const after = before.map((line, index) => (index === 1 || index === 17 ? `${line} changed` : line))

async function turnFixture(activeRuntimes = async () => [] as const) {
  const { root, cleanup } = await checkpointRepository()
  cleanups.push(cleanup)
  const file = path.join(root, 'app.txt')
  await writeFile(file, `${before.join('\n')}\n`)
  await runGit(root, ['add', 'app.txt'])
  await runGit(root, ['commit', '-m', 'turn zero'])
  await runGit(root, ['update-ref', checkpointRefForSessionTurn(sessionId, 0), 'HEAD'])
  await writeFile(file, `${after.join('\n')}\n`)
  await runGit(root, ['commit', '-am', 'turn one'])
  const turnOneRef = checkpointRefForSessionTurn(sessionId, 1)
  await runGit(root, ['update-ref', turnOneRef, 'HEAD'])

  const orchestration = checkpointOrchestration(root)
  cleanups.push(orchestration.close)
  await dispatchCheckpointSession(orchestration.engine, root, turnOneRef, [
    { additions: 2, deletions: 2, path: 'app.txt' },
  ])
  const hunks = new OrchestrationCheckpointHunks({
    runWorkspaceOperation: (operation) => orchestration.engine.runWorkspaceOperation(operation),
    activeRuntimes,
    diffs: new OrchestrationCheckpointDiffQuery(orchestration.database, orchestration.git),
    git: orchestration.git,
    readModel: () => orchestration.engine.readModelSnapshot(),
  })
  return { engine: orchestration.engine, file, hunks, read: () => readFile(file, 'utf8') }
}

describe('checkpoint hunks', () => {
  it('undoes one change of a turn, reports it reverted, and puts it back', async () => {
    const { hunks, read } = await turnFixture()
    const states = await hunks.states({ sessionId, turnCount: 1 })
    expect(states.map((hunk) => hunk.state)).toEqual(['applied', 'applied'])
    const [first, second] = states

    await hunks.revert({ hunkId: first!.hunkId, path: first!.path, sessionId, turnCount: 1 })
    const undone = (await read()).split('\n')
    expect(undone[1]).toBe('line 2')
    expect(undone[17]).toBe('line 18 changed')
    expect(
      (await hunks.states({ sessionId, turnCount: 1 })).map((hunk) => [hunk.hunkId, hunk.state]),
    ).toEqual([
      [first!.hunkId, 'reverted'],
      [second!.hunkId, 'applied'],
    ])

    await hunks.revert({
      hunkId: first!.hunkId,
      path: first!.path,
      reapply: true,
      sessionId,
      turnCount: 1,
    })
    expect(await read()).toBe(`${after.join('\n')}\n`)
  })

  it('refuses a change whose lines were edited since, and reports it changed', async () => {
    const { file, hunks } = await turnFixture()
    const [first] = await hunks.states({ sessionId, turnCount: 1 })
    const edited = after.map((line, index) => (index === 1 ? 'line 2 edited by hand' : line))
    await writeFile(file, `${edited.join('\n')}\n`)

    await expect(
      hunks.revert({ hunkId: first!.hunkId, path: first!.path, sessionId, turnCount: 1 }),
    ).rejects.toThrow('no longer matches the file')
    const states = await hunks.states({ sessionId, turnCount: 1 })
    expect(states.map((hunk) => hunk.state)).toEqual(['changed', 'applied'])
  })

  it('takes back every change the turn made to a file', async () => {
    const { hunks, read } = await turnFixture()
    const [first] = await hunks.states({ sessionId, turnCount: 1 })

    await hunks.revert({ hunkId: null, path: first!.path, sessionId, turnCount: 1 })
    expect(await read()).toBe(`${before.join('\n')}\n`)
  })

  it('names a change that is not in the turn', async () => {
    const { hunks } = await turnFixture()
    const [first] = await hunks.states({ sessionId, turnCount: 1 })

    await expect(
      hunks.revert({ hunkId: 'ffffffffffffffff', path: first!.path, sessionId, turnCount: 1 }),
    ).rejects.toThrow('is not in this turn')
  })
})

it('holds turn admission until checkpoint undo finishes applying its patch', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const { engine, hunks, read } = await turnFixture(async () => {
    entered.resolve()
    await release.promise
    return [] as const
  })
  const undo = hunks.revert({ sessionId, turnCount: 1, path: 'app.txt', hunkId: null })
  await entered.promise
  let admitted = false
  const send = engine
    .dispatch({
      type: 'session.turn.start',
      commandId: v.parse(commandIdSchema, 'send-during-undo'),
      sessionId,
      turnId: v.parse(turnIdSchema, 'turn-during-undo'),
      message: {
        messageId: v.parse(messageIdSchema, 'prompt-during-undo'),
        role: 'user',
        text: 'Continue',
        attachments: [],
      },
    })
    .then(() => {
      admitted = true
    })
  try {
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(admitted).toBe(false)
  } finally {
    release.resolve()
    await Promise.all([undo, send])
  }
  expect(await read()).toBe(`${before.join('\n')}\n`)
  expect(admitted).toBe(true)
})
