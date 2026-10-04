import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { bindX6FreshSource, verifyX6FreshMap } from './ghostty-x6-public-fresh.ts'
import { instrumentSource } from './ghostty-x6-source-ledger.ts'

test('requires byte equality and rejects historical source exceptions', () => {
  const current = readFileSync(new URL('./ghostty-x6-public-overlap.ts', import.meta.url), 'utf8')
  const exported = current.replace('interface ClockMapping', 'export interface ClockMapping')
  const oldInterval = current.replace(
    'assert(end > start, `Runner job ${job.id} unresolved zero-width or reversed interval`)',
    'assert(end >= start, `Runner job ${job.id} interval`)',
  )
  expect(bindX6FreshSource('current.ts', current, current).classification).toBe('BYTE-EQUAL')
  expect(() => bindX6FreshSource('current.ts', exported, current)).toThrow()
  expect(() => bindX6FreshSource('current.ts', oldInterval, current)).toThrow()
  expect(() => bindX6FreshSource('current.ts', current + '\n', current)).toThrow()
})

test('binds every raw and instrumented map input to current bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'x6-fresh-'))
  try {
    mkdirSync(join(root, 'src/core'), { recursive: true })
    const source = 'const result = (() => ({ value: 1 }))();\n'
    writeFileSync(join(root, 'src/core/example.ts'), source)
    const map = join(root, 'entry.mjs.map')
    const payload = { sources: ['src/core/example.ts'], sourcesContent: [source] }
    writeFileSync(map, JSON.stringify(payload))
    expect(verifyX6FreshMap(map, root, false)).toHaveLength(1)
    expect(() => verifyX6FreshMap(map, root, true)).toThrow()
    payload.sourcesContent[0] = instrumentSource('src/core/example.ts', source).source
    writeFileSync(map, JSON.stringify(payload))
    expect(verifyX6FreshMap(map, root, true)).toHaveLength(1)
    expect(() => verifyX6FreshMap(map, root, false)).toThrow()
    writeFileSync(join(root, 'src/core/example.ts'), source + '\n')
    expect(() => verifyX6FreshMap(map, root, true)).toThrow()
    payload.sources.push('src/core/example.ts')
    payload.sourcesContent.push(payload.sourcesContent[0]!)
    writeFileSync(map, JSON.stringify(payload))
    expect(() => verifyX6FreshMap(map, root, true)).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
