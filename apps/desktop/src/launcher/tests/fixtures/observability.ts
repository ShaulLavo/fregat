import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test as base, vi } from 'vitest'
import { resetObservabilityForTests } from '@workspace/observability'

export const test = base.extend<{
  logging: { root: string; stateHome: string; releaseRoot: string; launcher: string }
}>({
  // eslint-disable-next-line no-empty-pattern -- Vitest fixture callbacks require destructured context.
  logging: async ({}, provide) => {
    const root = await mkdtemp(path.join(tmpdir(), 'fregat-launcher-logs-'))
    const stateHome = path.join(root, 'state')
    const releaseRoot = path.join(root, 'release')
    const launcher = path.join(root, 'apps/desktop/src/launcher/index.js')
    await mkdir(path.join(stateHome, 'desktop'), { recursive: true })
    vi.stubEnv('OBSERVABILITY_DIR', undefined)
    vi.stubEnv('OBSERVABILITY_ENABLED', undefined)
    vi.stubEnv('OBSERVABILITY_CONSOLE', 'false')
    vi.stubEnv('OBSERVABILITY_POSTHOG_ENABLED', 'false')
    try {
      await provide({ root, stateHome, releaseRoot, launcher })
    } finally {
      await resetObservabilityForTests()
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    }
  },
})

export async function readLogEvents(directory: string) {
  const files = await readdir(directory)
  const text = (
    await Promise.all(
      files
        .filter((file) => file.endsWith('.jsonl'))
        .map((file) => readFile(path.join(directory, file), 'utf8')),
    )
  ).join('')
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
}
