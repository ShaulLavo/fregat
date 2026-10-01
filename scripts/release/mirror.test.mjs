import { expect, test } from 'vitest'
import { chmod, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { YAML } from 'bun'
import { withWorkspace } from './fixture.mjs'

const workflow = YAML.parse(
  await readFile(new URL('../../.github/workflows/mirror.yml', import.meta.url), 'utf8'),
)
const script = workflow.jobs.mirror.steps.find((step) => step.name === 'Split and push family').run
const keyScript = workflow.jobs.mirror.steps.find(
  (step) => step.name === 'Configure repository deploy key',
).run
const workspace = fileURLToPath(new URL('../../', import.meta.url))
const knownHosts = join(workspace, '.github/github_known_hosts')

test('every mirror checks out the pinned host keys before configuring SSH', () => {
  const steps = workflow.jobs.mirror.steps
  const checkout = steps.findIndex((step) => step.name === 'Checkout full history')
  const configure = steps.findIndex((step) => step.name === 'Configure repository deploy key')
  expect(checkout).toBeGreaterThanOrEqual(0)
  expect(checkout).toBeLessThan(configure)
  expect(steps[checkout].with['persist-credentials']).toBe(false)
  expect(workflow.jobs.mirror.strategy.matrix.include.map((entry) => entry.folder)).toEqual([
    'editor',
    'ghostty-webgpu',
    'hotkeys',
  ])
})

test('pinned GitHub host keys match all three published SHA256 fingerprints', () => {
  const found = spawnSync('ssh-keygen', ['-F', 'github.com', '-f', knownHosts], {
    encoding: 'utf8',
  })
  expect(found.status, found.stderr).toBe(0)
  const fingerprints = spawnSync('ssh-keygen', ['-lf', knownHosts, '-E', 'sha256'], {
    encoding: 'utf8',
  })
  expect(fingerprints.status, fingerprints.stderr).toBe(0)
  expect(fingerprints.stdout.trim().split('\n')).toEqual([
    '256 SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU github.com (ED25519)',
    '256 SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM github.com (ECDSA)',
    '3072 SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s github.com (RSA)',
  ])
})

test('missing mirror credentials fail visibly before the push', async () => {
  await withWorkspace(async ({ root }) => {
    const result = spawnSync('bash', ['-c', keyScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MIRROR_SSH_KEY: '',
        MIRROR_KEY_SECRET: 'FIXTURE_KEY',
        RUNNER_TEMP: root,
      },
    })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('::error::Configure FIXTURE_KEY')
  })
})

test('mirror SSH setup succeeds offline with private credentials and strict host verification', async () => {
  await withWorkspace(async ({ root }) => {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const curl = join(bin, 'curl')
    await writeFile(
      curl,
      '#!/bin/sh\ntouch "$RUNNER_TEMP/curl-called"\nprintf "curl: (22) The requested URL returned error: 403\\n" >&2\nexit 22\n',
    )
    await chmod(curl, 0o700)
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MIRROR_SSH_KEY: 'fixture-private-key',
      MIRROR_KEY_SECRET: 'FIXTURE_KEY',
      RUNNER_TEMP: root,
      GITHUB_ENV: join(root, 'github-env'),
      GITHUB_WORKSPACE: workspace,
    }
    const result = spawnSync('bash', ['-c', keyScript], { encoding: 'utf8', env })
    expect(result.status, result.stderr).toBe(0)
    expect(`${result.stdout}${result.stderr}`).not.toContain('fixture-private-key')
    const key = join(root, 'mirror-ssh/id_ed25519')
    expect((await stat(key)).mode & 0o777).toBe(0o600)
    await expect(stat(join(root, 'curl-called'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(root, 'mirror-ssh/known_hosts'), 'utf8')).toBe(
      await readFile(knownHosts, 'utf8'),
    )
    const sshCommand = await readFile(env.GITHUB_ENV, 'utf8')
    expect(sshCommand).toContain(`UserKnownHostsFile='${join(root, 'mirror-ssh/known_hosts')}'`)
    expect(sshCommand).toContain('StrictHostKeyChecking=yes')
    const cleanup = workflow.jobs.mirror.steps.find((step) => step.name === 'Remove deploy key').run
    expect(spawnSync('bash', ['-c', cleanup], { env }).status).toBe(0)
    await expect(stat(key)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout.trim()
}

function mirror(cwd, family = 'hotkeys') {
  return spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAMILY_FOLDER: family,
      MIRROR_REPOSITORY: 'fixture/mirror',
    },
  })
}

test.each(['editor', 'ghostty-webgpu'])(
  'mirrors the tracked %s family tree after a legacy link',
  async (family) => {
    await withWorkspace(async ({ root }) => {
      const origin = join(root, 'origin.git')
      const destination = join(root, 'mirror.git')
      const source = join(root, 'source')
      git(root, 'init', '--bare', '--initial-branch=main', origin)
      git(root, 'init', '--bare', '--initial-branch=main', destination)
      git(root, 'clone', origin, source)
      git(source, 'config', 'user.name', 'Fixture')
      git(source, 'config', 'user.email', 'fixture@example.com')
      git(source, 'config', `url.${destination}.insteadOf`, 'git@github.com:fixture/mirror.git')
      await mkdir(join(source, 'outside'))
      await symlink('outside', join(source, family))
      git(source, 'add', family)
      git(source, 'commit', '-m', 'legacy link')
      git(source, 'push', 'origin', 'main')
      const skipped = mirror(source, family)
      expect(skipped.status, `${skipped.stdout}\n${skipped.stderr}`).toBe(0)
      expect(skipped.stdout).toContain(`${family} has not landed yet.`)
      await rm(join(source, family))
      git(source, 'add', family)
      git(source, 'commit', '-m', 'remove legacy link')
      const imported = join(root, 'family-input')
      git(root, 'init', '--initial-branch=main', imported)
      await writeFile(join(imported, 'index.js'), 'family')
      git(imported, 'add', 'index.js')
      git(
        imported,
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '-m',
        'family tree',
      )
      git(source, 'subtree', 'add', `--prefix=${family}`, imported, 'main')
      git(source, 'push', 'origin', 'main')
      const current = mirror(source, family)
      expect(current.status, `${current.stdout}\n${current.stderr}`).toBe(0)
      expect(git(destination, 'show', 'main:index.js')).toBe('family')
    })
  },
)

async function commitFamily(root, content) {
  await writeFile(join(root, 'hotkeys/index.js'), content)
  git(root, 'add', 'hotkeys/index.js')
  git(
    root,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-m',
    content,
  )
  git(root, 'push', 'origin', 'main')
}

test('mirror push reports SSH host verification failures', async () => {
  await withWorkspace(async ({ root }) => {
    const origin = join(root, 'origin.git')
    const source = join(root, 'source')
    const ssh = join(root, 'ssh')
    git(root, 'init', '--bare', '--initial-branch=main', origin)
    git(root, 'clone', origin, source)
    await mkdir(join(source, 'hotkeys'))
    await commitFamily(source, 'first')
    await writeFile(ssh, '#!/bin/sh\nprintf "Host key verification failed.\\n" >&2\nexit 255\n')
    await chmod(ssh, 0o700)
    git(source, 'config', 'core.sshCommand', `'${ssh}'`)
    git(source, 'config', 'ssh.variant', 'ssh')
    const result = mirror(source)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Host key verification failed.')
    expect(result.stdout).toContain('::error::Mirror push rejected or failed for fixture/mirror.')
    expect(result.stdout).not.toContain('Mirror skipped:')
  })
})

test('mirrors current snapshots and skips an older replay while preserving the newer head', async () => {
  await withWorkspace(async ({ root }) => {
    const origin = join(root, 'origin.git')
    const destination = join(root, 'mirror.git')
    const source = join(root, 'source')
    const older = join(root, 'older')
    const newer = join(root, 'newer')
    git(root, 'init', '--bare', '--initial-branch=main', origin)
    git(root, 'init', '--bare', '--initial-branch=main', destination)
    git(root, 'clone', origin, source)
    await mkdir(join(source, 'hotkeys'))
    await commitFamily(source, 'first')
    git(root, 'clone', origin, older)
    git(older, 'config', `url.${destination}.insteadOf`, 'git@github.com:fixture/mirror.git')
    const initial = mirror(older)
    expect(initial.status, `${initial.stdout}\n${initial.stderr}`).toBe(0)
    const first = git(destination, 'rev-parse', 'main')
    await commitFamily(source, 'second')
    git(root, 'clone', origin, newer)
    git(newer, 'config', `url.${destination}.insteadOf`, 'git@github.com:fixture/mirror.git')
    const current = mirror(newer)
    expect(current.status, `${current.stdout}\n${current.stderr}`).toBe(0)
    const second = git(destination, 'rev-parse', 'main')
    expect(second).not.toBe(first)
    const replay = mirror(older)
    expect(replay.status, `${replay.stdout}\n${replay.stderr}`).toBe(0)
    expect(replay.stdout).toContain('Mirror skipped: a newer main snapshot is available.')
    expect(git(destination, 'rev-parse', 'main')).toBe(second)
    expect(mirror(newer).status).toBe(0)
    const outsider = join(root, 'outsider')
    git(root, 'clone', destination, outsider)
    await writeFile(join(outsider, 'outside.txt'), 'outside commit')
    git(outsider, 'add', 'outside.txt')
    git(
      outsider,
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '-m',
      'outside commit',
    )
    git(outsider, 'push', 'origin', 'main')
    const outside = git(destination, 'rev-parse', 'main')
    const rejected = mirror(newer)
    expect(rejected.status).toBe(1)
    expect(rejected.stdout).toContain('Mirror push rejected or failed')
    expect(git(destination, 'rev-parse', 'main')).toBe(outside)
  })
})
