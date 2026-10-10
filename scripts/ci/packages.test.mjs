import { expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const runner = path.join(import.meta.dirname, 'packages.mjs')

function runFixture(operation, names, failure = '') {
  const root = mkdtempSync(path.join(tmpdir(), 'ci-package-runner-'))
  try {
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        workspaces: { packages: ['packages/*'] },
        scripts: { 'build:workspaces': 'turbo run build --filter=@workspace/*' },
      }),
    )
    writeFileSync(path.join(root, 'turbo.json'), '{"globalDependencies":[],"tasks":{}}')
    writeFileSync(
      path.join(root, 'task.mjs'),
      'import {appendFileSync} from "node:fs"; const task=process.argv.slice(2).join(" "); appendFileSync(process.env.RECEIPT,task+"\\n"); process.exit(task===process.env.FAIL_TASK?23:0)',
    )
    for (const name of ['alpha', 'beta', 'ghostty-webgpu', 'ghostty-webgpu-line-editor']) {
      const directory = path.join(root, 'packages', name)
      mkdirSync(directory, { recursive: true })
      const scripts = Object.fromEntries(
        ['format:check', 'lint', 'typecheck', 'test'].map((task) => [
          task,
          `bun ../../task.mjs ${name} ${task}`,
        ]),
      )
      writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({
          name: name.startsWith('ghostty-') ? name : `@workspace/${name}`,
          scripts,
        }),
      )
    }
    const receipt = path.join(root, 'receipt')
    writeFileSync(receipt, '')
    const result = spawnSync('bun', [runner, operation, JSON.stringify(names)], {
      cwd: root,
      env: { ...process.env, RECEIPT: receipt, FAIL_TASK: failure },
      encoding: 'utf8',
    })
    return {
      status: result.status,
      calls: readFileSync(receipt, 'utf8').trim().split('\n').filter(Boolean),
      stderr: result.stderr,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('selected package scripts execute without checking unrelated packages', () => {
  expect(runFixture('checks', ['@workspace/alpha'])).toMatchObject({
    status: 0,
    calls: ['alpha format:check', 'alpha lint', 'alpha typecheck'],
  })
  expect(runFixture('tests', ['@workspace/beta'])).toMatchObject({
    status: 0,
    calls: ['beta test'],
  })
})

test('a selected package failure propagates its exit status', () => {
  expect(runFixture('checks', ['@workspace/alpha', '@workspace/beta'], 'alpha lint')).toMatchObject(
    { status: 23, calls: ['alpha format:check', 'alpha lint'] },
  )
})

test('empty package selection executes no commands', () => {
  expect(runFixture('checks', [])).toMatchObject({ status: 0, calls: [] })
})

test('family verification owns Ghostty checks without a duplicate package execution', () => {
  expect(
    runFixture('checks', ['ghostty-webgpu', 'ghostty-webgpu-line-editor', '@workspace/alpha']),
  ).toMatchObject({ status: 0, calls: ['alpha format:check', 'alpha lint', 'alpha typecheck'] })
})

test('package names are validated before command execution', () => {
  expect(runFixture('checks', ['@workspace/unknown'])).toMatchObject({ status: 1, calls: [] })
})
