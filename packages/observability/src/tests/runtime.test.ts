import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  flushObservability,
  initializeObservabilityRuntime,
  isObservabilityActive,
  recordObservabilityInfo,
  resetObservabilityForTests,
  setLogRetentionDays,
} from '../runtime'

afterEach(async () => {
  await resetObservabilityForTests()
})

describe('observability runtime', () => {
  it('uses OBSERVABILITY_ENABLED as the master off switch', () => {
    const runtime = initializeObservabilityRuntime({
      env: {
        NODE_ENV: 'production',
        OBSERVABILITY_CONSOLE: 'true',
        OBSERVABILITY_ENABLED: 'false',
        OBSERVABILITY_POSTHOG_ENABLED: 'true',
        POSTHOG_API_KEY: 'phc_test',
      },
      source: 'test',
    })

    recordObservabilityInfo('test.disabled')

    expect(runtime.config.enabled).toBe(false)
    expect(runtime.drain).toBeNull()
    expect(isObservabilityActive()).toBe(false)
  })

  it('resolves relative log dirs from the monorepo root', async () => {
    const cwd = process.cwd()
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), 'platform-observability-runtime-')),
    )

    try {
      await writeFile(path.join(root, 'bun.lock'), '')
      const nestedCwd = path.join(root, 'apps/server')
      await mkdir(nestedCwd, { recursive: true })

      process.chdir(nestedCwd)
      const runtime = initializeObservabilityRuntime({
        env: {
          NODE_ENV: 'production',
          OBSERVABILITY_ENABLED: 'false',
        },
        source: 'test',
      })

      expect(runtime.config.logDir).toBe(path.join(root, 'logs'))
    } finally {
      process.chdir(cwd)
      await rm(root, { force: true, recursive: true })
    }
  })

  it('preserves absolute log dirs', () => {
    const logDir = path.join(process.cwd(), 'tmp/logs')
    const runtime = initializeObservabilityRuntime({
      env: {
        NODE_ENV: 'production',
        OBSERVABILITY_DIR: logDir,
        OBSERVABILITY_ENABLED: 'false',
      },
      source: 'test',
    })

    expect(runtime.config.logDir).toBe(logDir)
  })

  it('prunes log days past the retention when it writes', async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), 'platform-observability-retention-'))
    await writeFile(path.join(logDir, '2020-01-01.jsonl'), '{}\n')
    try {
      initializeObservabilityRuntime({
        env: {
          NODE_ENV: 'production',
          OBSERVABILITY_BATCH_SIZE: '1',
          OBSERVABILITY_CONSOLE: 'false',
          OBSERVABILITY_DIR: logDir,
          OBSERVABILITY_ENABLED: 'true',
        },
        source: 'test',
      })
      setLogRetentionDays(() => 7)
      recordObservabilityInfo('test.retention')
      await flushObservability()

      const names = await readdir(logDir)
      expect(names).not.toContain('2020-01-01.jsonl')
      expect(names.some((name) => name.endsWith('.jsonl'))).toBe(true)
    } finally {
      setLogRetentionDays(() => 0)
      await rm(logDir, { force: true, recursive: true })
    }
  })

  it('writes a batch once when its retention throws', async () => {
    const logDir = await mkdtemp(path.join(tmpdir(), 'platform-observability-retention-'))
    try {
      initializeObservabilityRuntime({
        env: {
          NODE_ENV: 'production',
          OBSERVABILITY_BATCH_SIZE: '1',
          OBSERVABILITY_CONSOLE: 'false',
          OBSERVABILITY_DIR: logDir,
          OBSERVABILITY_ENABLED: 'true',
        },
        source: 'test',
      })
      setLogRetentionDays(() => {
        throw new TypeError('settings unavailable')
      })
      recordObservabilityInfo('test.retention_throws')
      await flushObservability()

      const names = (await readdir(logDir)).filter((name) => name.endsWith('.jsonl'))
      const text = (
        await Promise.all(names.map((name) => readFile(path.join(logDir, name), 'utf8')))
      ).join('')
      expect(text.match(/test\.retention_throws/gu)).toHaveLength(1)
    } finally {
      setLogRetentionDays(() => 0)
      await rm(logDir, { force: true, recursive: true })
    }
  })
})
