import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative } from 'node:path'
import { expect, it } from 'vitest'
import type { ViteUserConfig } from 'vitest/config'
import config from '../vitest.config'

it('stores automatic browser screenshots in an existing temporary directory', () => {
  const directory = (config as ViteUserConfig).test?.browser?.screenshotDirectory
  expect(directory).toBeDefined()
  expect(isAbsolute(directory!)).toBe(true)
  expect(relative(tmpdir(), directory!).startsWith('..')).toBe(false)
  expect(existsSync(directory!)).toBe(true)
  expect((config as ViteUserConfig).server?.fs?.allow).toContain(directory)
})

it.each(['viewport-replacement.browser.test.ts', 'viewport-cancellation.browser.test.ts'])(
  '%s lets the runner name and store screenshots',
  (filename) => {
    const source = readFileSync(new URL(filename, import.meta.url), 'utf8')
    const calls = source.match(/page\.screenshot\([\s\S]*?\)/g) ?? []
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call).not.toMatch(/\bpath\s*:/)
  },
)
