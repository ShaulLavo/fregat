import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
const ci = Bun.YAML.parse(readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8'))
const plan = ci.jobs.changes.steps.find((step) => step.id === 'plan')
const mode = new Function('github', `return (${plan.env.MODE.replace(/^\$\{\{\s*|\s*\}\}$/g, '')})`)

test.each([
  ['pull_request', undefined, 'changed'],
  ['push', 'a'.repeat(40), 'changed'],
  ['push', '0'.repeat(40), 'full'],
  ['schedule', undefined, 'full'],
  ['workflow_dispatch', undefined, 'full'],
])('%s uses %s as its baseline event and selects %s validation', (event, before, expected) => {
  expect(mode({ event_name: event, event: { before } })).toBe(expected)
})

const gitAvailable = Bun.which('git') !== null && Bun.which('bash') !== null
if (!gitAvailable) console.info('Skipping main baseline shell proof. Git and Bash are required.')

test.skipIf(!gitAvailable).each(['success', 'none'])(
  'main covers replaced queued runs with baseline %s',
  (baseline) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'ci-main-baseline-'))
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
    try {
      for (const folder of ['apps/web', 'scripts/ci', 'bin'])
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
      writeFileSync(path.join(directory, 'apps/web/index.ts'), 'export const value = 1\n')
      writeFileSync(path.join(directory, 'PLAN.md'), '# Plan\n')
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
      const before = git('rev-parse', 'HEAD')
      writeFileSync(path.join(directory, 'PLAN.md'), '# Updated plan\n')
      git('commit', '-qam', 'newest documentation push')
      writeFileSync(path.join(directory, 'bin/gh'), '#!/bin/sh\nprintf "%s\\n" "$VERIFIED_SHA"\n', {
        mode: 0o755,
      })
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', plan.run], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${path.join(directory, 'bin')}:${process.env.PATH}`,
          GITHUB_EVENT_NAME: 'push',
          GH_REPO: 'fixture/repo',
          MODE: 'changed',
          BASE_SHA: before,
          HEAD_SHA: git('rev-parse', 'HEAD'),
          VERIFIED_SHA: baseline === 'success' ? verified : '',
        },
        encoding: 'utf8',
      })
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        packages: ['web'],
        web: true,
        docs: true,
        exhaustive: baseline === 'none',
      })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
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
