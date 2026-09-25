import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { OrchestrationCheckpointDiffQuery } from '../checkpoint-diff-query'
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

async function repository() {
  const { root, cleanup } = await checkpointRepository()
  cleanups.push(cleanup)
  return root
}

function orchestration(root: string) {
  const setup = checkpointOrchestration(root)
  cleanups.push(setup.close)
  return {
    checkpointDiff: new OrchestrationCheckpointDiffQuery(setup.database, setup.git),
    engine: setup.engine,
  }
}

describe('orchestration checkpoint diff query', () => {
  it('validates empty ranges against a real session', async () => {
    const { checkpointDiff } = orchestration(await repository())

    await expect(
      checkpointDiff.turnDiff({
        fromTurnCount: 0,
        sessionId,
        toTurnCount: 0,
      }),
    ).rejects.toThrow('Session not found')
  })

  it('reads historical turn diffs from checkpoint refs', async () => {
    const root = await repository()
    const turnZeroRef = checkpointRefForSessionTurn(sessionId, 0)
    const turnOneRef = checkpointRefForSessionTurn(sessionId, 1)

    await writeFile(path.join(root, 'app.txt'), 'before\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn zero'])
    await runGit(root, ['update-ref', turnZeroRef, 'HEAD'])
    await writeFile(path.join(root, 'app.txt'), 'after\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn one'])
    await runGit(root, ['update-ref', turnOneRef, 'HEAD'])

    const { checkpointDiff, engine } = orchestration(root)

    await dispatchCheckpointSession(engine, root, turnOneRef)
    const diffs = await checkpointDiff.turnDiff({
      fromTurnCount: 0,
      sessionId,
      toTurnCount: 1,
    })

    expect(diffs).toMatchObject([
      {
        path: 'app.txt',
        hunks: [
          {
            changes: [
              { oldLine: 1, text: 'before', type: 'deleted' },
              { newLine: 1, text: 'after', type: 'added' },
            ],
          },
        ],
      },
    ])
    expect(diffs[0]?.oldObjectId).toEqual(expect.any(String))
    expect(diffs[0]?.newObjectId).toEqual(expect.any(String))
  })

  it('hides whitespace-only hunks for display and counts them by default', async () => {
    const root = await repository()
    const turnZeroRef = checkpointRefForSessionTurn(sessionId, 0)
    const turnOneRef = checkpointRefForSessionTurn(sessionId, 1)

    await writeFile(path.join(root, 'app.txt'), 'before\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn zero'])
    await runGit(root, ['update-ref', turnZeroRef, 'HEAD'])
    // The only change between the refs is leading whitespace.
    await writeFile(path.join(root, 'app.txt'), '  before\n')
    await runGit(root, ['add', 'app.txt'])
    await runGit(root, ['commit', '-m', 'turn one'])
    await runGit(root, ['update-ref', turnOneRef, 'HEAD'])

    const { checkpointDiff, engine } = orchestration(root)

    await dispatchCheckpointSession(engine, root, turnOneRef)

    const display = await checkpointDiff.turnDiff({
      fromTurnCount: 0,
      ignoreWhitespace: true,
      sessionId,
      toTurnCount: 1,
    })
    expect(display).toEqual([])

    const honest = await checkpointDiff.turnDiff({
      fromTurnCount: 0,
      sessionId,
      toTurnCount: 1,
    })
    expect(honest).toHaveLength(1)
  })
})
