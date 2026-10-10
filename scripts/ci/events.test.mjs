import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
const ci = Bun.YAML.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'))
const plan = ci.jobs.changes.steps.find((step) => step.id === 'plan')
const gitAvailable = Bun.which('git') !== null && Bun.which('bash') !== null
if (!gitAvailable) console.info('Skipping event selection shell proof. Git and Bash are required.')

function runPlan({ event, beforeKind, ref, baseline = 'success' }) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-event-selection-'))
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
  try {
    for (const folder of ['apps/web', 'apps/server', 'scripts/ci', 'bin', 'docs'])
      mkdirSync(path.join(directory, folder), { recursive: true })
    writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['apps/*'] },
        scripts: { 'build:workspaces': 'turbo run build --filter=web' },
      }),
    )
    writeFileSync(path.join(directory, 'turbo.json'), '{"globalDependencies":[],"tasks":{}}')
    writeFileSync(path.join(directory, 'apps/web/package.json'), '{"name":"web"}')
    writeFileSync(path.join(directory, 'apps/server/package.json'), '{"name":"server"}')
    writeFileSync(path.join(directory, 'apps/web/index.ts'), 'export const value = 1\n')
    writeFileSync(path.join(directory, 'PLAN.md'), '# Plan\n')
    writeFileSync(path.join(directory, 'docs/Unchanged.md'), '# Unchanged\n')
    writeFileSync(
      path.join(directory, 'scripts/ci/affected.mjs'),
      readFileSync(path.join(root, 'scripts/ci/affected.mjs')),
    )
    git('init', '-q')
    git('config', 'user.name', 'CI fixture')
    git('config', 'user.email', 'ci@example.test')
    git('add', '.')
    git('commit', '-qm', 'successful baseline')
    const verified = git('rev-parse', 'HEAD')
    writeFileSync(path.join(directory, 'apps/web/index.ts'), 'export const value = 2\n')
    git('commit', '-qam', 'queued code change')
    const previous = git('rev-parse', 'HEAD')
    writeFileSync(path.join(directory, 'PLAN.md'), '# Updated plan\n')
    git('commit', '-qam', 'newest documentation push')
    writeFileSync(path.join(directory, 'bin/gh'), '#!/bin/sh\nprintf "%s\\n" "$VERIFIED_SHA"\n', {
      mode: 0o755,
    })
    let before = ''
    if (beforeKind === 'existing') before = previous
    if (beforeKind === 'initial') before = '0'.repeat(40)
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', plan.run], {
      cwd: directory,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: event,
        GITHUB_REF: ref,
        GITHUB_OUTPUT: path.join(directory, 'outputs'),
        GITHUB_STEP_SUMMARY: path.join(directory, 'summary'),
        PATH: `${path.join(directory, 'bin')}:${process.env.PATH}`,
        GH_REPO: 'fixture/repo',
        BEFORE_SHA: before,
        BASE_SHA: event === 'pull_request' ? verified : previous,
        HEAD_SHA: git('rev-parse', 'HEAD'),
        VERIFIED_SHA: baseline === 'success' ? verified : '',
      },
      encoding: 'utf8',
    })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    return JSON.parse(result.stdout)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test.skipIf(!gitAvailable).each([
  ['pull_request', 'missing', 'refs/pull/123/merge', false],
  ['push', 'existing', 'refs/heads/main', false],
  ['push', 'initial', 'refs/heads/main', true],
  ['push', 'missing', 'refs/heads/main', true],
  ['push', 'existing', 'refs/tags/v0.1.0', true],
  ['schedule', 'missing', 'refs/heads/main', true],
  ['workflow_dispatch', 'missing', 'refs/heads/main', true],
])('%s with %s before on %s selects exhaustive=%s', (event, beforeKind, ref, exhaustive) => {
  expect(runPlan({ event, beforeKind, ref })).toMatchObject({
    packages: exhaustive ? ['server', 'web'] : ['web'],
    web: true,
    server: exhaustive,
    docs: true,
    docs_files: exhaustive ? ['PLAN.md', 'docs/Unchanged.md'] : ['PLAN.md'],
    exhaustive,
  })
})

test.skipIf(!gitAvailable).each(['success', 'none'])(
  'main covers replaced queued runs with baseline %s',
  (baseline) => {
    expect(
      runPlan({ event: 'push', beforeKind: 'existing', ref: 'refs/heads/main', baseline }),
    ).toMatchObject({
      packages: baseline === 'none' ? ['server', 'web'] : ['web'],
      web: true,
      docs: true,
      exhaustive: baseline === 'none',
    })
  },
)

test('expensive collaboration and textbuffer runs are scheduled or manual', () => {
  for (const file of [
    'editor-collab.yml',
    'editor-collaboration.yml',
    'editor-textbuffer-bench.yml',
  ]) {
    const workflow = Bun.YAML.parse(
      readFileSync(path.join(root, '.github/workflows', file), 'utf8'),
    )
    expect(workflow.on).not.toHaveProperty('pull_request')
    expect(workflow.on).not.toHaveProperty('push')
    expect(workflow.on).toHaveProperty('schedule')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  }
})
