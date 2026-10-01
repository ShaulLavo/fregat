import { expect, test } from 'vitest'

import { redactCommand } from './record'

test.each([
  [
    ['env', 'GITHUB_TOKEN=ghp_abc', 'x'],
    ['env', 'GITHUB_TOKEN=<redacted>', 'x'],
  ],
  [
    ['tool', '--api-key=k-123', '--port=5'],
    ['tool', '--api-key=<redacted>', '--port=5'],
  ],
  [
    ['tool', '--token', 'abc', 'next'],
    ['tool', '--token', '<redacted>', 'next'],
  ],
  [
    ['curl', '-H', 'Authorization: Bearer abc.def'],
    ['curl', '-H', 'Authorization: <redacted>'],
  ],
  [
    ['git', 'clone', 'https://me:pw@host/r'],
    ['git', 'clone', 'https://<redacted>@host/r'],
  ],
  [
    ['bash', '-c', 'OPENAI_API_KEY=sk-live1234567890abcdef run'],
    ['bash', '-c', 'OPENAI_API_KEY=<redacted> run'],
  ],
  [
    ['echo', 'sk-ant-api03-abcdefghijklmnopqrstuv'],
    ['echo', '<redacted>'],
  ],
  [
    ['echo', 'ghp_0123456789abcdefghijABCDEFGHIJ'],
    ['echo', '<redacted>'],
  ],
])('redacts secrets in %j', (command, expected) => {
  expect(redactCommand(command)).toEqual(expected)
})

test('keeps ordinary commands whole', () => {
  const command = ['bun', '--bun', 'vitest', 'run', 'apps/web/src/keymap', '--project', 'dom']
  expect(redactCommand(command)).toEqual(command)
})

test('caps a long argument so one record stays one short line', () => {
  const [script] = redactCommand(['x'.repeat(5_000)])
  expect(script?.length).toBeLessThanOrEqual(1_000)
  expect(script?.endsWith('…')).toBe(true)
})
