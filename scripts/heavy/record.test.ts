import { expect, test } from 'vitest'

import { redactCommand } from './record'

test.each([
  [
    ['env', 'GITHUB_TOKEN=ghp_abc', 'x'],
    ['env', 'GITHUB_TOKEN=<redacted>', 'x'],
  ],
  [
    ['env', 'PASSWORD=first second', 'true'],
    ['env', 'PASSWORD=<redacted>', 'true'],
  ],
  [
    ['env', 'SECRET=line1\nline2', 'x'],
    ['env', 'SECRET=<redacted>', 'x'],
  ],
  [
    ['tool', '--api-key=k-123', '--port=5'],
    ['tool', '--api-key=<redacted>', '--port=5'],
  ],
  [
    ['tool', '--token', 'abc def', 'next'],
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
    ['curl', 'https://host/?api-key=swordfish&page=2'],
    ['curl', 'https://host/?api-key=<redacted>&page=2'],
  ],
  [
    ['curl', 'https://host/p?key=swordfish'],
    ['curl', 'https://host/p?key=<redacted>'],
  ],
  [
    ['bash', '-c', 'curl --password swordfish https://host'],
    ['bash', '-c', 'curl --password <redacted> https://host'],
  ],
  [
    ['bash', '-c', "PASSWORD='first second' run"],
    ['bash', '-c', 'PASSWORD=<redacted>'],
  ],
  [
    ['bash', '-c', "env PASSWORD='first second' run"],
    ['bash', '-c', 'env PASSWORD=<redacted> run'],
  ],
  [
    ['sh', '-c', 'run --token="a b" && next'],
    ['sh', '-c', 'run --token=<redacted> && next'],
  ],
  [
    ['bash', '-c', `curl -H "Authorization: Basic dXNlcjpwYXNz" x`],
    ['bash', '-c', "curl -H 'Authorization: <redacted>' x"],
  ],
  [
    ['bash', '-c', 'cd x && OPENAI_API_KEY=sk-live1234567890abcdef run'],
    ['bash', '-c', 'cd x && OPENAI_API_KEY=<redacted> run'],
  ],
  [
    ['bash', '-c', 'curl -H "X-Trace: Bearer abc" x'],
    ['bash', '-c', 'curl -H "X-Trace: <redacted>" x'],
  ],
  [
    ['echo', 'sk-ant-api03-abcdefghijklmnopqrstuv'],
    ['echo', '<redacted>'],
  ],
  [
    ['echo', 'ghp_0123456789abcdefghijABCDEFGHIJ'],
    ['echo', '<redacted>'],
  ],
  [
    ['tool', 'Zx8Kq2Lm9Np4Rt7Vw1Yb3Cd6Fg0Hj5Ks'],
    ['tool', '<redacted>'],
  ],
])('redacts secrets in %j', (command, expected) => {
  expect(redactCommand(command)).toEqual(expected)
})

test('no credential fragment survives into the serialized command', () => {
  const command = [
    'bash',
    '-c',
    "PASSWORD='first second' curl --password swordfish -H 'Authorization: Bearer tok3n value' 'https://u:pw@h/?api-key=hunter2'",
  ]
  const serialized = JSON.stringify(redactCommand(command))
  for (const fragment of ['first', 'second', 'swordfish', 'tok3n', 'value', 'u:pw', 'hunter2']) {
    expect(serialized).not.toContain(fragment)
  }
})

test('keeps ordinary commands whole', () => {
  const commands = [
    ['bun', '--bun', 'vitest', 'run', 'apps/web/src/keymap', '--project', 'dom'],
    ['git', 'log', '--format=%H', 'eca143b00066537df621de8feeccc7009254375d'],
    ['bash', '-c', 'cd apps/web && bun run test -- --shard=1/4'],
  ]
  for (const command of commands) expect(redactCommand(command)).toEqual(command)
})

test('caps a long argument so one record stays one short line', () => {
  const [script] = redactCommand(['x'.repeat(5_000)])
  expect(script?.length).toBeLessThanOrEqual(1_000)
  expect(script?.endsWith('…')).toBe(true)
})
