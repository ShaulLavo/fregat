import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { checkoutRoot, scratchPath, scratchRoot } from './paths'

it('uses the canonical OS temp directory and this checkout', () => {
  expect(scratchRoot).toBe(realpathSync(tmpdir()))
  expect(path.dirname(scratchPath('fregat-fixture-'))).toBe(scratchRoot)
  expect(checkoutRoot).toBe(path.resolve(import.meta.dirname, '../..'))
})

it('keeps Linux scratch directories out of browser fixtures', async () => {
  const files = new Bun.Glob('**/*.ts').scan({ cwd: import.meta.dirname })
  const offenders: string[] = []
  for await (const file of files) {
    if (file.endsWith('.test.ts')) continue
    const source = await readFile(path.join(import.meta.dirname, file), 'utf8')
    if (source.includes('/work/tmp')) offenders.push(file)
  }
  expect(offenders).toEqual([])
})
