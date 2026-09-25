import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { GitPublishRequest } from '@workspace/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../../../test/factories/git-worktree'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../fs/limits'
import { createWorkspacePaths } from '../../fs/path'
import type { RunProcess } from '../forges/types'
import { GitService } from '../service'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const ok = (stdout = '') => ({ exitCode: 0, stderr: '', stdout })

/** A signed-in `gh` whose `repo create` succeeds; every other CLI call fails. */
function github(signedIn = true) {
  const calls: (readonly string[])[] = []
  const run: RunProcess = async ({ argv }) => {
    calls.push(argv)
    if (argv[1] === 'auth')
      return signedIn ? ok() : { exitCode: 1, stderr: 'not logged in', stdout: '' }
    if (argv[1] === 'repo' && argv[2] === 'create') return ok('https://github.com/acme/app\n')
    return { exitCode: 1, stderr: 'unexpected', stdout: '' }
  }
  return { calls, run }
}

/** A checkout whose pushes to github.com/acme land in a local bare repository instead. */
async function checkout(options: { commit?: boolean; bare?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-publish-'))
  roots.push(root)
  const bare = path.join(root, 'remote.git')
  if (options.bare !== false) await runGit(root, ['init', '--bare', '-b', 'main', bare])
  const work = path.join(root, 'work')
  await mkdir(work)
  await runGit(work, ['init', '-b', 'main'])
  await runGit(work, ['config', 'user.email', 'test@example.com'])
  await runGit(work, ['config', 'user.name', 'Test User'])
  await runGit(work, ['config', `url.${bare}.insteadOf`, 'https://github.com/acme/app.git'])
  if (options.commit !== false) {
    await writeFile(path.join(work, 'readme.md'), 'hello\n')
    await runGit(work, ['add', '--all'])
    await runGit(work, ['commit', '-m', 'initial'])
  }
  return { root, work, bare }
}

function service(root: string, run: RunProcess) {
  return new GitService(createWorkspacePaths(root), {
    forgeBoundaries: { run },
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
}

const request: GitPublishRequest = {
  path: 'work',
  forge: 'github',
  repository: 'acme/app',
  visibility: 'private',
  protocol: 'https',
}

describe('publish', () => {
  it('creates the repository, adds origin and pushes the branch', async () => {
    const { root, work, bare } = await checkout()
    const forge = github()
    await expect(service(root, forge.run).publish(request)).resolves.toEqual({
      url: 'https://github.com/acme/app',
      remoteName: 'origin',
      remoteUrl: 'https://github.com/acme/app.git',
      branch: 'main',
      status: 'pushed',
      pushError: null,
    })
    expect(forge.calls.find((argv) => argv[2] === 'create')).toEqual([
      'gh',
      'repo',
      'create',
      'acme/app',
      '--private',
    ])
    expect(await runGit(bare, ['branch', '--format', '%(refname:short)'])).toBe('main')
    expect(await runGit(work, ['rev-parse', '--abbrev-ref', 'main@{u}'])).toBe('origin/main')
  })

  it('adds the remote and pushes nothing when there is no commit yet', async () => {
    const { root, work } = await checkout({ commit: false })
    const result = await service(root, github().run).publish(request)
    expect(result.status).toBe('remote-added')
    expect(await runGit(work, ['remote'])).toBe('origin')
  })

  it('reports a failed push after the repository exists, keeping the remote', async () => {
    const { root, work } = await checkout({ bare: false })
    const result = await service(root, github().run).publish(request)
    expect(result.status).toBe('push-failed')
    expect(result.pushError).toBeTruthy()
    expect(await runGit(work, ['remote'])).toBe('origin')
  })

  it('creates nothing when the forge is not signed in', async () => {
    const { root, work } = await checkout()
    const forge = github(false)
    await expect(service(root, forge.run).publish(request)).rejects.toThrow(
      'GitHub is not ready: nobody is signed in',
    )
    expect(forge.calls.some((argv) => argv[2] === 'create')).toBe(false)
    expect(await runGit(work, ['remote'])).toBe('')
  })

  it('names the remote origin-1 when origin already points elsewhere', async () => {
    const { root, work } = await checkout()
    await runGit(work, ['remote', 'add', 'origin', 'https://example.com/other.git'])
    const result = await service(root, github().run).publish({ ...request, protocol: 'https' })
    expect(result.remoteName).toBe('origin-1')
  })
})
