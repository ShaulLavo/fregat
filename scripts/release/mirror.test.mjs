import { expect, test } from 'vitest'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { YAML } from 'bun'
import { withWorkspace } from './fixture.mjs'

const workflow = YAML.parse(
  await readFile(new URL('../../.github/workflows/mirror.yml', import.meta.url), 'utf8'),
)
const script = workflow.jobs.mirror.steps.find((step) => step.name === 'Split and push family').run

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
      MIRROR_TOKEN: 'fixture-token',
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
      git(source, 'config', `url.${destination}.insteadOf`, 'https://github.com/fixture/mirror.git')
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
    git(older, 'config', `url.${destination}.insteadOf`, 'https://github.com/fixture/mirror.git')
    const initial = mirror(older)
    expect(initial.status, `${initial.stdout}\n${initial.stderr}`).toBe(0)
    const first = git(destination, 'rev-parse', 'main')
    await commitFamily(source, 'second')
    git(root, 'clone', origin, newer)
    git(newer, 'config', `url.${destination}.insteadOf`, 'https://github.com/fixture/mirror.git')
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
