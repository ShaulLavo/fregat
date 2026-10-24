import { hash } from 'node:crypto'
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  DEVELOPMENT_POLICY,
  DEVELOPMENT_POLICY_SHA256,
  requireDevelopmentPolicy,
  runtimeSourceExcluded,
} from './development-exclusions'

test('every pinned generator family rejects every runtime-string shape without normalization', () => {
  expect(DEVELOPMENT_POLICY.rules.map((rule) => rule.id)).toEqual([
    'open-file-log',
    'open-file-notes',
    'stream-source-image',
    'stream-replaced-id',
    'warmup-final-image',
  ])
  const middles = ['', '\n', '\r\n', '\0', '👩🏽‍💻', '\ud800', ').\n[link](x)', 'x'.repeat(20000)]
  for (const rule of DEVELOPMENT_POLICY.rules) {
    expect(rule.prefix.length).toBeGreaterThan(0)
    expect(rule.suffix.length).toBeGreaterThan(0)
    for (const middle of middles)
      expect(runtimeSourceExcluded(rule.prefix + middle + rule.suffix)).toBe(true)
    expect(runtimeSourceExcluded('changed' + rule.prefix + 'runtime' + rule.suffix)).toBe(false)
    expect(runtimeSourceExcluded(rule.prefix + 'runtime' + rule.suffix + 'changed')).toBe(false)
  }
  expect(runtimeSourceExcluded('See [the log](')).toBe(false)
  expect(runtimeSourceExcluded('![Answer](')).toBe(false)
  expect(runtimeSourceExcluded('Independent **message**.')).toBe(false)
})

test('policy identity binds matcher bytes and immutable recipe provenance', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-policy-control-'))
  try {
    const directory = path.join(root, 'scripts/markdown')
    await mkdir(directory, { recursive: true })
    for (const name of ['development-exclusions.ts', 'development-exclusion-policy.json'])
      await writeFile(path.join(directory, name), await readFile(new URL(name, import.meta.url)))
    expect(() => requireDevelopmentPolicy(root, DEVELOPMENT_POLICY_SHA256)).not.toThrow()
    expect(() => requireDevelopmentPolicy(root, hash('sha256', 'changed'))).toThrow()
    await writeFile(path.join(directory, 'development-exclusions.ts'), 'changed matcher')
    expect(() => requireDevelopmentPolicy(root, DEVELOPMENT_POLICY_SHA256)).toThrow()
    await writeFile(
      path.join(directory, 'development-exclusions.ts'),
      await readFile(new URL('./development-exclusions.ts', import.meta.url)),
    )
    const policy = JSON.parse(
      await readFile(path.join(directory, 'development-exclusion-policy.json'), 'utf8'),
    )
    policy.rules[0].provenance.fileSha256 = hash('sha256', 'changed recipe')
    await writeFile(
      path.join(directory, 'development-exclusion-policy.json'),
      JSON.stringify(policy),
    )
    expect(() => requireDevelopmentPolicy(root, DEVELOPMENT_POLICY_SHA256)).toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
