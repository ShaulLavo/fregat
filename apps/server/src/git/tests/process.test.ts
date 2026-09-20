import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import { GitService } from '../service'
import {
  defaultTimeoutMs,
  HOOK_TIMEOUT_MS,
  gitProcessErrors,
  LOCAL_TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  runProcess,
} from '../utils/process'

const BIG_BLOB_BYTES = 2_000_000
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('git process limits', () => {
  it('runs a normal command without a limit', async () => {
    const root = await fixtureRepo()

    const result = await runProcess({ args: ['rev-parse', '--abbrev-ref', 'HEAD'], cwd: root })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('main')
    expect(result.limit).toBeUndefined()
  })

  it('stops reading at the byte cap instead of buffering the whole output', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'big.txt'), 'x'.repeat(BIG_BLOB_BYTES))
    const objectId = (await runProcess({ args: ['hash-object', '-w', 'big.txt'], cwd: root }))
      .stdout

    const result = await runProcess({
      args: ['cat-file', '-p', objectId.trim()],
      cwd: root,
      maxOutputBytes: 1024,
    })

    expect(result.limit).toMatchObject({ kind: 'output-limit', maxBytes: 1024, stream: 'stdout' })
    expect(result.stdout).toBe('')
    const observedBytes = result.limit?.kind === 'output-limit' ? result.limit.observedBytes : 0
    expect(observedBytes).toBeGreaterThan(1024)
    expect(observedBytes).toBeLessThan(BIG_BLOB_BYTES / 2)
  })

  it('kills a command that never exits and reports the timeout', async () => {
    const root = await fixtureRepo()
    const startedAt = performance.now()

    const result = await runProcess({
      // A shell alias git waits on: the only way to make git itself hang
      // deterministically without a network.
      args: ['-c', 'alias.hang=!sleep 5', 'hang'],
      cwd: root,
      timeoutMs: 300,
    })

    expect(result.limit).toEqual({ kind: 'timeout', timeoutMs: 300 })
    expect(result.exitCode).not.toBe(0)
    expect(performance.now() - startedAt).toBeLessThan(3_000)
  })

  it('gives network commands the longer default bound', () => {
    expect(defaultTimeoutMs(['fetch'])).toBe(NETWORK_TIMEOUT_MS)
    expect(defaultTimeoutMs(['pull'])).toBe(NETWORK_TIMEOUT_MS)
    // Hooks are user code: a monorepo typecheck in pre-commit outlasts any local limit.
    expect(defaultTimeoutMs(['commit'])).toBe(HOOK_TIMEOUT_MS)
    expect(defaultTimeoutMs(['push'])).toBe(HOOK_TIMEOUT_MS)
    expect(defaultTimeoutMs(['status'])).toBe(LOCAL_TIMEOUT_MS)
    expect(defaultTimeoutMs(['diff'])).toBe(LOCAL_TIMEOUT_MS)
  })
})

describe('git service output limit', () => {
  it('fails a diff that overflows the command output budget', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), `${'line\n'.repeat(50_000)}`)
    const service = new GitService(createWorkspacePaths(root), {
      maxCommandOutputBytes: 4096,
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
    })

    const diff = service.diff('')

    await expect(diff).rejects.toMatchObject({
      code: gitProcessErrors.OUTPUT_LIMIT_EXCEEDED.code,
      status: 413,
    })
  })

  it('leaves a diff below the budget alone', async () => {
    const root = await fixtureRepo()
    await writeFile(path.join(root, 'tracked.txt'), 'two\n')
    const service = new GitService(createWorkspacePaths(root), {
      maxCommandOutputBytes: 4096,
      maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
    })

    const diffs = await service.diff('')

    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.path).toBe('tracked.txt')
  })
})

async function fixtureRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-git-process-'))
  roots.push(root)
  await runProcess({ args: ['init', '-b', 'main'], cwd: root })
  await runProcess({ args: ['config', 'user.email', 'test@example.com'], cwd: root })
  await runProcess({ args: ['config', 'user.name', 'Test User'], cwd: root })
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await runProcess({ args: ['add', 'tracked.txt'], cwd: root })
  await runProcess({ args: ['commit', '-m', 'initial'], cwd: root })
  return root
}
