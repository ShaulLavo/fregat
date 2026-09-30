import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readWorkflow } from './workflow-fixtures'

test('every explicitly dispatched workflow accepts workflow_dispatch', () => {
  const directory = path.resolve(import.meta.dirname, '../.github/workflows')
  const sources = readdirSync(directory).filter((file) => file.endsWith('.yml'))
  const targets = sources.flatMap((file) => {
    const workflow = readWorkflow(file)
    return Object.values(workflow.jobs).flatMap((job) =>
      job.steps.flatMap((step) =>
        [...(step.run ?? '').matchAll(/gh workflow run ([\w.-]+\.yml)/g)].map((match) => match[1]!),
      ),
    )
  })
  expect(targets).toContain('ci.yml')
  for (const target of targets) {
    expect(readWorkflow(target).on, target).toHaveProperty('workflow_dispatch')
  }
})

test('the parser updater dispatches the CI verdict that includes Editor checks', () => {
  const workflow = readWorkflow('editor-tree-sitter-x.yml')
  const commands = workflow.jobs.update!.steps.map((step) => step.run ?? '').join('\n')
  expect(commands).toContain('gh workflow run ci.yml --ref "$branch"')
  expect(readWorkflow('ci.yml').jobs.verdict!.needs).toContain('libraries')
})

function updaterFixture(existingBranch: boolean) {
  const root = mkdtempSync(path.join(tmpdir(), 'platform-parser-workflow-'))
  const directory = path.join(root, 'checkout')
  const github = path.join(root, 'github')
  const bin = path.join(root, 'bin')
  for (const entry of [directory, github, bin]) mkdirSync(entry)
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: directory,
    })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    return result.stdout.toString().trim()
  }
  git('init', '--bare', '-q', path.join(root, 'origin.git'))
  git('init', '-b', 'main', '-q')
  git('config', 'user.name', 'fixture')
  git('config', 'user.email', 'fixture@example.com')
  git('config', 'core.hooksPath', '/dev/null')
  git('remote', 'add', 'origin', path.join(root, 'origin.git'))
  const manifest = path.join(directory, 'editor/packages/tree-sitter/package.json')
  mkdirSync(path.dirname(manifest), { recursive: true })
  const pin = (revision: string) =>
    writeFileSync(
      manifest,
      JSON.stringify({
        dependencies: { 'web-tree-sitter': `github:ShaulLavo/tree-sitter-x#${revision}` },
      }),
    )
  pin('e2985e0')
  git('add', '.')
  git('commit', '-qm', 'initial pin')
  if (existingBranch) {
    git('switch', '-qc', 'tree-sitter-x/ba4f1d2')
    pin('ba4f1d2')
    git('commit', '-qam', 'update pin')
    git('push', '-q', 'origin', 'HEAD:refs/heads/tree-sitter-x/ba4f1d2')
    git('switch', '-q', 'main')
  }
  pin('ba4f1d2')
  const gh = path.join(bin, 'gh')
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$FIXTURE_GITHUB/commands"
case "$1 $2" in
  'pr list') if [ -f "$FIXTURE_GITHUB/pr" ]; then cat "$FIXTURE_GITHUB/pr"; fi ;;
  'pr view') if [ -f "$FIXTURE_GITHUB/pr" ]; then cat "$FIXTURE_GITHUB/pr"; else exit 1; fi ;;
  'pr create')
    if [ -f "$FIXTURE_GITHUB/deny-create" ]; then echo 'GitHub Actions is not permitted to create pull requests' >&2; exit 1; fi
    echo OPEN > "$FIXTURE_GITHUB/pr" ;;
  'pr edit') ;;
  'run list') if [ -f "$FIXTURE_GITHUB/run" ]; then echo 1; else echo 0; fi ;;
  'workflow run')
    if [ -f "$FIXTURE_GITHUB/deny-dispatch" ]; then exit 1; fi
    touch "$FIXTURE_GITHUB/run" ;;
  *) exit 64 ;;
esac
`,
  )
  chmodSync(gh, 0o755)
  const command = readWorkflow('editor-tree-sitter-x.yml').jobs.update!.steps.find(
    (step) => step.name === 'Open a pull request',
  )!.run!
  const invoke = () => {
    git('switch', '-q', 'main')
    pin('ba4f1d2')
    return Bun.spawnSync(['bash', '-e', '-o', 'pipefail', '-c', command], {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_TOKEN: 'fixture',
        FIXTURE_GITHUB: github,
      },
    })
  }
  return { root, github, git, invoke }
}

test.each([false, true])(
  'parser update recovers denied PR creation with an existing branch: %s',
  (existingBranch) => {
    const fixture = updaterFixture(existingBranch)
    try {
      const denied = path.join(fixture.github, 'deny-create')
      writeFileSync(denied, '')
      expect(fixture.invoke().exitCode).not.toBe(0)
      const pushed = fixture.git('ls-remote', 'origin', 'refs/heads/tree-sitter-x/ba4f1d2')
      expect(pushed).toContain('refs/heads/tree-sitter-x/ba4f1d2')
      unlinkSync(denied)
      const recovered = fixture.invoke()
      expect(recovered.exitCode, recovered.stderr.toString()).toBe(0)
      expect(readFileSync(path.join(fixture.github, 'pr'), 'utf8').trim()).toBe('OPEN')
      expect(existsSync(path.join(fixture.github, 'run'))).toBe(true)
      expect(fixture.git('ls-remote', 'origin', 'refs/heads/tree-sitter-x/ba4f1d2')).toBe(pushed)
      expect(fixture.invoke().exitCode).toBe(0)
      const commands = readFileSync(path.join(fixture.github, 'commands'), 'utf8')
      expect(commands.match(/^pr create /gm)).toHaveLength(2)
      expect(commands.match(/^workflow run /gm)).toHaveLength(1)
      expect(commands).toContain(`--commit ${pushed.split(/\s/)[0]}`)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  },
)

test('parser update recovers CI dispatch after the PR already exists', () => {
  const fixture = updaterFixture(true)
  try {
    const denied = path.join(fixture.github, 'deny-dispatch')
    writeFileSync(denied, '')
    expect(fixture.invoke().exitCode).not.toBe(0)
    expect(readFileSync(path.join(fixture.github, 'pr'), 'utf8').trim()).toBe('OPEN')
    unlinkSync(denied)
    expect(fixture.invoke().exitCode).toBe(0)
    expect(existsSync(path.join(fixture.github, 'run'))).toBe(true)
    expect(fixture.invoke().exitCode).toBe(0)
    const commands = readFileSync(path.join(fixture.github, 'commands'), 'utf8')
    expect(commands.match(/^pr create /gm)).toHaveLength(1)
    expect(commands.match(/^workflow run /gm)).toHaveLength(2)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test.each(['CLOSED', 'MERGED'])('parser update preserves a %s pull request', (state) => {
  const fixture = updaterFixture(true)
  try {
    writeFileSync(path.join(fixture.github, 'pr'), state)
    expect(fixture.invoke().exitCode).toBe(0)
    expect(readFileSync(path.join(fixture.github, 'pr'), 'utf8')).toBe(state)
    expect(existsSync(path.join(fixture.github, 'run'))).toBe(false)
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
