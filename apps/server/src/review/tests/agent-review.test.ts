import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AGENT_REVIEW_OUTPUT_SCHEMA } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { closeTestApps, createTestApp, createTestDatabase } from '../../../test/server'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../provider/provider-adapter-registry'
import { testSettingsOptions } from '../../settings/testing'
import { runGit } from '../../testing/git'
import { REVIEW_PATCH_BUDGET } from '../agent-review'

const ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const answer = (root: string) =>
  JSON.stringify({
    findings: [
      {
        title: 'Off by one',
        body: 'The loop skips the last item.',
        confidence_score: 0.8,
        priority: 1,
        code_location: { absolute_file_path: 'src/sum.ts', line_range: { start: 2, end: 3 } },
      },
      {
        title: 'Absolute path',
        body: 'Named by its absolute path.',
        confidence_score: 0.5,
        priority: 2,
        code_location: {
          absolute_file_path: path.join(root, 'src/sum.ts'),
          line_range: { start: 1, end: 1 },
        },
      },
      {
        title: 'Outside',
        body: 'A file outside the checkout.',
        confidence_score: 0.5,
        priority: 2,
        code_location: { absolute_file_path: '/etc/hosts', line_range: { start: 1, end: 1 } },
      },
    ],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'One bug.',
    overall_confidence_score: 0.7,
  })

describe('agent review', () => {
  it('reviews uncommitted changes with the findings schema and places findings on their lines', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'src/sum.ts'), 'export const sum = (xs) =>\n  xs.slice(1)\n')
    const adapter = new MockProviderAdapter({ responseText: answer(root) })
    const response = await review(testApp(root, adapter), { kind: 'uncommitted' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      findings: [
        { path: 'src/sum.ts', startLine: 2, endLine: 3, title: 'Off by one', priority: 1 },
        { path: 'src/sum.ts', startLine: 1, endLine: 1, title: 'Absolute path' },
      ],
      unplacedCount: 1,
      verdict: 'patch is incorrect',
    })
    const turn = adapter.startedTurns.at(-1)
    expect(turn?.outputSchema).toEqual(AGENT_REVIEW_OUTPUT_SCHEMA)
    expect(turn?.messageText).toContain('+  xs.slice(1)')
    expect(turn?.cwd).not.toBe(root)
  })

  it('refuses an empty change and a patch past the budget', async () => {
    const root = await fixtureRepo()
    const adapter = new MockProviderAdapter({ responseText: answer(root) })
    const app = testApp(root, adapter)
    expect(await errorCode(await review(app, { kind: 'uncommitted' }))).toContain(
      'REVIEW_NOTHING_TO_REVIEW',
    )

    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(REVIEW_PATCH_BUDGET + 10))
    expect(await errorCode(await review(app, { kind: 'uncommitted' }))).toContain(
      'REVIEW_PATCH_TOO_LARGE',
    )
    expect(adapter.startedTurns).toHaveLength(0)
  })

  it('reads a commit from the checkout itself, read-only', async () => {
    const root = await fixtureRepo()
    const sha = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim()
    const adapter = new MockProviderAdapter({ responseText: answer(root) })
    const response = await review(testApp(root, adapter), { kind: 'commit', sha })

    expect(response.status).toBe(200)
    const turn = adapter.startedTurns.at(-1)
    expect(turn).toMatchObject({ cwd: root, interactionMode: 'plan' })
    expect(turn?.messageText).toContain(`git show ${sha}`)
  })

  it('names an answer outside the schema', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    const adapter = new MockProviderAdapter({ responseText: 'Looks good to me.' })
    expect(await errorCode(await review(testApp(root, adapter), { kind: 'uncommitted' }))).toContain(
      'REVIEW_RESPONSE_UNREADABLE',
    )
  })
})

function review(app: ReturnType<typeof testApp>, target: Record<string, unknown>) {
  return app.handle(
    new Request('http://local/agent-review', {
      body: JSON.stringify({
        rootPath: '',
        target,
        reviewer: { providerInstanceId: 'codex', model: 'gpt-5.5' },
      }),
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      method: 'POST',
    }),
  )
}

function testApp(root: string, adapter: MockProviderAdapter) {
  return createTestApp({
    auth: { allowedOrigins: [ORIGIN] },
    metadataDatabase: createTestDatabase(),
    orchestration: { providerAdapterRegistry: new ProviderAdapterRegistry([adapter]) },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
}

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-review-'))
  roots.push(root)
  await runGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runGit(root, ['add', 'tracked.txt'])
  await runGit(root, ['commit', '-m', 'initial'])
  await mkdir(path.join(root, 'src'))
  return root
}

async function errorCode(response: Response) {
  const payload = (await response.json()) as { error: { code: string } }
  return payload.error.code
}
