import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { caseScopeCommand, runCaseScope } from './case-scope'

const MiB = 2 ** 20
const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const scope = {
  unit: 'case.scope',
  memoryMiB: 2560,
  command: ['bun', 'bench.ts'],
  accountingFile: '/tmp/case.accounting',
}
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

test.skipIf(process.platform !== 'linux')('joins the heavy job slice when one is named', () => {
  expect(caseScopeCommand({ ...scope, slice: 'lane_x.slice' })).toContain('--slice=lane_x.slice')
  expect(caseScopeCommand(scope).some((arg) => arg.startsWith('--slice'))).toBe(false)
  expect(caseScopeCommand(scope)).toContain('Delegate=yes')
  expect(caseScopeCommand(scope).slice(-4)).toEqual([
    scope.accountingFile,
    '2560M',
    'bun',
    'bench.ts',
  ])
  expect(caseScopeCommand(scope)).toContain('--expand-environment=no')
})

function runCase(name: string, mib: number, memoryMiB: number) {
  return runCommand(name, memoryMiB, [
    'bun',
    '-e',
    `const b = Buffer.alloc(${mib} * 2 ** 20, 1); console.log(b.length)`,
  ])
}

function runCommand(name: string, memoryMiB: number, command: readonly string[]) {
  const root = mkdtempSync(path.join(tmpdir(), 'large-file-scope-'))
  roots.push(root)
  return runCaseScope({
    unit: `large-file-scope-test-${process.pid}-${name}.scope`,
    memoryMiB,
    command,
    accountingFile: path.join(root, 'scope.accounting'),
    cwd: root,
    env: process.env,
    stdout: path.join(root, 'stdout.log'),
    stderr: path.join(root, 'stderr.log'),
    timeoutMs: 30_000,
  })
}

describe.skipIf(!userScopes)('a bench case scope', () => {
  // systemd unloads a scope that exited successfully, so a peak read after exit can be lost.
  test('reports the peak of a case that exited successfully', async () => {
    const outcome = await runCase('ok', 220, 1024)
    expect(outcome.exitCode).toBe(0)
    expect(outcome.memoryPeakBytes).toBeGreaterThanOrEqual(200 * MiB)
  })

  test('reports the exit code and peak of a case killed by its cap', async () => {
    const outcome = await runCase('capped', 400, 128)
    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.memoryPeakBytes).toBeGreaterThanOrEqual(100 * MiB)
  })

  // Inside the cap, the shim's first fork after an OOM kill could find the cap still full of the
  // killed case's memory, and the kernel would kill the shim before it wrote the totals.
  test('caps the case alone and keeps the shim outside that cap', async () => {
    const outcome = await runCommand('leaves', 128, [
      'bash',
      '-c',
      'read -r line </proc/self/cgroup; leaf=/sys/fs/cgroup${line#0::}; cat "$leaf/memory.max" "$leaf/../shim/memory.max" "$leaf/../shim/cgroup.procs"',
    ])
    expect(outcome.exitCode).toBe(0)
    const [caseMax, shimMax, shimPid] = readFileSync(path.join(roots.at(-1)!, 'stdout.log'), 'utf8')
      .trim()
      .split('\n')
    expect([caseMax, shimMax]).toEqual([String(128 * MiB), 'max'])
    expect(Number(shimPid)).toBeGreaterThan(0)
  })

  test('runs the case under OOMPolicy=continue, so systemd never kills the shim on OOM', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'large-file-scope-'))
    roots.push(root)
    const unit = `large-file-scope-test-${process.pid}-policy.scope`
    await runCaseScope({
      unit,
      memoryMiB: 256,
      command: ['systemctl', '--user', 'show', '-p', 'OOMPolicy', '--value', unit],
      accountingFile: path.join(root, 'scope.accounting'),
      cwd: root,
      env: process.env,
      stdout: path.join(root, 'stdout.log'),
      stderr: path.join(root, 'stderr.log'),
      timeoutMs: 30_000,
    })
    expect(readFileSync(path.join(root, 'stdout.log'), 'utf8').trim()).toBe('continue')
  })
})
