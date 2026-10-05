import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

const INSTALL = path.join(import.meta.dirname, 'install.ts')
const CHECKOUT = path.resolve(import.meta.dirname, '../..')
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const checkoutClean =
  spawnSync('git', ['-C', CHECKOUT, 'status', '--porcelain']).stdout.toString() === ''
const roots: string[] = []

const sliceRoots: string[] = []

afterEach(() => {
  for (const root of sliceRoots.splice(0))
    spawnSync('systemctl', ['--user', 'stop', `${root}.slice`])
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function temp(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function run(command: string, args: readonly string[], cwd = CHECKOUT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  return { code: result.status, stderr: result.stderr, stdout: result.stdout }
}

function repoWithCommits(count: number) {
  const repo = temp('heavy-install-repo-')
  run('git', ['init', '-q'], repo)
  for (let index = 0; index < count; index++) {
    writeFileSync(path.join(repo, 'file'), String(index))
    run('git', ['add', 'file'], repo)
    run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `c${index}`], repo)
  }
  return repo
}

test.each([null, 'invalid', 'configured'])(
  'requires its own root before reading source with deploy target %s',
  (target) => {
    const scratch = temp('heavy-install-target-')
    const home = path.join(scratch, 'home')
    mkdirSync(path.join(home, '.platform'), { recursive: true })
    writeFileSync(
      path.join(home, '.platform/settings.json'),
      JSON.stringify({
        'developer.deployTarget':
          target === 'configured'
            ? {
                productionRoot: path.join(scratch, 'application'),
                meshHost: 'fixture',
                meshOrigin: 'https://fixture.example',
                meshRoute: '/',
              }
            : target,
      }),
    )
    const result = spawnSync('bun', [INSTALL, '--source', path.join(scratch, 'absent')], {
      cwd: CHECKOUT,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, 'cache'),
      },
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('An installation root is required for the heavy-job wrapper.')
    expect(result.stderr).toContain('--root=<directory>')
    expect(result.stderr).not.toContain('git status')
    expect(readdirSync(home)).toEqual(['.platform'])
    expect(readdirSync(path.join(home, '.platform'))).toEqual(['settings.json'])
    expect(readdirSync(scratch).toSorted()).toEqual(['cache', 'home'])
  },
)

test('an explicit wrapper root works with a null application deploy target', () => {
  const repo = repoWithCommits(1)
  const scratch = temp('heavy-install-explicit-')
  const home = path.join(scratch, 'home')
  mkdirSync(path.join(home, '.platform'), { recursive: true })
  writeFileSync(path.join(home, '.platform/settings.json'), '{"developer.deployTarget":null}')
  const head = run('git', ['rev-parse', 'HEAD'], repo).stdout.trim()
  const root = path.join(scratch, 'wrapper')
  mkdirSync(path.join(root, head), { recursive: true })
  writeFileSync(path.join(root, head, 'commit'), head)
  const result = spawnSync('bun', [INSTALL, '--source', repo, '--root', root], {
    cwd: CHECKOUT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(scratch, 'cache'),
    },
  })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('Already installed')
  expect(readlinkSync(path.join(root, 'current'))).toBe(head)
  expect(readFileSync(path.join(root, head, 'commit'), 'utf8')).toBe(head)
  expect(readdirSync(path.join(home, '.platform'))).toEqual(['settings.json'])
})

test('refuses a tree with uncommitted changes and installs nothing', () => {
  const repo = repoWithCommits(1)
  writeFileSync(path.join(repo, 'stray'), '')
  const root = temp('heavy-install-root-')
  const result = run('bun', [INSTALL, '--source', repo, '--root', root])
  expect(result.code).toBe(2)
  expect(result.stderr).toContain('1 uncommitted change')
  expect(readdirSync(root)).toEqual([])
})

test('refuses a commit the checkout is not at', () => {
  const repo = repoWithCommits(2)
  const root = temp('heavy-install-root-')
  const result = run('bun', [INSTALL, '--source', repo, '--root', root, '--commit', 'HEAD~1'])
  expect(result.code).toBe(2)
  expect(result.stderr).toMatch(/The checkout is at [0-9a-f]{40}, not [0-9a-f]{40}\./)
  expect(readdirSync(root)).toEqual([])
})

test.skipIf(!userScopes || !checkoutClean)(
  'installs this clean checkout behind current, and the installed wrapper records its commit',
  () => {
    const head = run('git', ['rev-parse', 'HEAD']).stdout.trim()
    const root = temp('heavy-install-root-')
    const installed = run('bun', [INSTALL, '--root', root, '--commit', head])
    expect(installed.code, installed.stderr).toBe(0)
    expect(readlinkSync(path.join(root, 'current'))).toBe(head)
    expect(readdirSync(path.join(root, head)).toSorted()).toEqual([
      'commit',
      'deadline.sh',
      'nested-scope.sh',
      'pi',
      'report.js',
      'run.js',
      'scope.sh',
      'status.js',
    ])
    expect(readdirSync(path.join(root, head, 'pi'))).toEqual(['launch.js'])

    const again = run('bun', [INSTALL, '--root', root])
    expect(again.stdout).toContain('Already installed')

    const work = temp('heavy-install-work-')
    const sliceRoot = `heavyt${randomBytes(4).toString('hex')}`
    sliceRoots.push(sliceRoot)
    mkdirSync(path.join(work, 'locks'))
    const runJs = path.join(root, 'current', 'run.js')
    const job = run(
      'bun',
      [
        runJs,
        '--slice-root',
        sliceRoot,
        '--state-dir',
        path.join(work, 'locks'),
        '--log-dir',
        path.join(work, 'logs'),
        'installed',
        '--',
        'true',
      ],
      work,
    )
    expect(job.code).toBe(0)
    const [file] = readdirSync(path.join(work, 'logs'))
    const record = JSON.parse(readFileSync(path.join(work, 'logs', file!), 'utf8'))
    expect(record).toMatchObject({
      commitHash: null,
      exitCode: 0,
      label: 'installed',
      version: head.slice(0, 9),
    })
    expect(record.memoryPeakBytes).toBeGreaterThan(0)
    expect(readdirSync(root).filter((entry) => entry.startsWith('.'))).toEqual([])
  },
  60_000,
)
