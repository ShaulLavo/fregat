import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/query-core'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  canUseSearchTools,
  createCommandAvailability,
  runToolLines,
  type SearchToolWarning,
} from '../search-tool-runner'

describe('search tool runner', () => {
  it('reports a tolerated failure to the caller instead of only the log', async () => {
    const warnings: SearchToolWarning[] = []

    const lines = await collect(
      runToolLines('sh', ['-c', 'echo found; echo denied >&2; exit 2'], undefined, [0], [2], {
        onWarning: (warning) => warnings.push(warning),
      }),
    )

    expect(lines).toEqual(['found'])
    expect(warnings).toEqual([
      { code: 2, command: 'sh', stderrTail: expect.stringContaining('denied') },
    ])
  })

  it('stays silent when the tool succeeds', async () => {
    const warnings: SearchToolWarning[] = []

    const lines = await collect(
      runToolLines('sh', ['-c', 'echo found'], undefined, [0], [2], {
        onWarning: (warning) => warnings.push(warning),
      }),
    )

    expect(lines).toEqual(['found'])
    expect(warnings).toEqual([])
  })

  it('still throws for an exit code that is not tolerated', async () => {
    await expect(
      collect(runToolLines('sh', ['-c', 'echo boom >&2; exit 3'], undefined, [0])),
    ).rejects.toMatchObject({ code: 'OPERATION_FAILED' })
  })
})

async function collect(lines: AsyncIterable<string>) {
  const result: string[] = []
  for await (const line of lines) result.push(line)

  return result
}

describe('command availability', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('shares concurrent checks and retries rejected acquisition', async () => {
    const client = new QueryClient()
    const check = vi.fn(async () => true).mockRejectedValueOnce(new Error('fixture failure'))
    const available = createCommandAvailability(client, check)
    try {
      const failed = await Promise.allSettled([available('rg'), available('rg')])
      expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
      expect(check).toHaveBeenCalledTimes(1)
      expect(await Promise.all([available('rg'), available('rg')])).toEqual([true, true])
      expect(check).toHaveBeenCalledTimes(2)
    } finally {
      client.clear()
    }
  })

  it('discovers a newly installed executable after negative expiry and separates PATH values', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const base = await mkdtemp(path.join(tmpdir(), 'platform-command-availability-'))
    try {
      vi.stubEnv('PATH', base)
      expect(await canUseSearchTools({ names: false, content: true })).toBe(false)
      await writeFile(path.join(base, 'rg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
      expect(await canUseSearchTools({ names: false, content: true })).toBe(false)
      vi.setSystemTime(Date.now() + 5000)
      expect(await canUseSearchTools({ names: false, content: true })).toBe(true)
      vi.stubEnv('PATH', path.join(base, 'missing'))
      expect(await canUseSearchTools({ names: false, content: true })).toBe(false)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
