import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkpointRefForSessionTurn, orchestrationForApp } from 'server/testing'
import { commandIdSchema, orchestrationCommandSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { Client } from '@/lib/client'
import { createRailHarness } from './rail-harness'
import { turnDiffSummary } from './chat'
import { runGit } from './git'
import type { TestServer } from '../server'

export async function checkpointTurn(
  client: Client,
  server: TestServer,
  after: readonly string[] = ['after\n', 'after\n'],
) {
  const root = server.root
  runGit(root, ['init', '--quiet'])
  const paths = ['app.txt', 'next.txt']
  for (const path of paths) await writeFile(join(root, path), 'before\n')
  runGit(root, ['add', '.'])
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
  runGit(root, identity.concat(['commit', '-qm', 'base']))
  const harness = await createRailHarness(client, server, ['Checkpoint'], '')
  const sessionId = harness.sessionIds[0]!
  runGit(root, ['update-ref', checkpointRefForSessionTurn(sessionId, 0), 'HEAD'])
  for (const [index, path] of paths.entries())
    await writeFile(join(root, path), after[index] ?? 'after\n')
  runGit(root, identity.concat(['commit', '-qam', 'turn']))
  const checkpointRef = checkpointRefForSessionTurn(sessionId, 1)
  runGit(root, ['update-ref', checkpointRef, 'HEAD'])
  const summary = turnDiffSummary({
    sessionId,
    checkpointRef,
    files: paths.map((path) => ({ additions: 1, deletions: 1, kind: 'modified', path })),
  })
  await orchestrationForApp(server.app).dispatch(
    v.parse(orchestrationCommandSchema, {
      ...summary,
      type: 'session.turn.diff.complete',
      commandId: v.parse(commandIdSchema, 'checkpoint'),
      createdAt: summary.completedAt!,
    }),
  )
  return { ...harness, summary }
}
