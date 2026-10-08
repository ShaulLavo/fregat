import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { expect, test } from 'vitest'

const tui = path.resolve(import.meta.dirname, '../../..')

function sourceLine(file: string, statement: string) {
  const source = readFileSync(path.join(tui, 'test/processes', file), 'utf8')
  const index = source.split('\n').findIndex((line) => line.includes(statement))
  expect(index).toBeGreaterThanOrEqual(0)
  return index + 1
}

test('delayed polling failures retain the original assertion and async helper locations', () => {
  const direct = sourceLine('source-location.probe.tsx', 'expect(null).not.toBeNull()')
  const poll = sourceLine('source-location.probe.tsx', 'await expect.poll(')
  const helper = sourceLine('source-location-helper.ts', 'await callback()')
  const run = spawnSync(
    process.execPath,
    ['--bun', 'vitest', 'run', '--config', 'test/processes/source-location.vitest.config.ts'],
    { cwd: tui, encoding: 'utf8', timeout: 30_000 },
  )
  const output = stripVTControlCharacters(`${run.stdout}${run.stderr}`)
  expect(run.error).toBeUndefined()
  expect(run.status).toBe(1)
  expect(output).toContain('2 failed')
  for (const line of [direct, poll]) {
    expect(output).toContain(`source-location.probe.tsx:${line}:`)
  }
  expect(output).toContain(`source-location-helper.ts:${helper}:`)
}, 60_000)
