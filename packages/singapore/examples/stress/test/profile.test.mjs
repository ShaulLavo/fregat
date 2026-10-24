import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('weights active samples, deduplicates recursive stacks, and resolves source locations', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'editor-profile-test-'))
  try {
    await writeProfile(directory)
    const script = fileURLToPath(new URL('../profile-summary.mjs', import.meta.url))
    const summary = JSON.parse(
      execFileSync(process.execPath, [script, directory], { encoding: 'utf8' }),
    )
    expect(summary.sampledMs).toBe(10)
    expect(summary.activeSampledMs).toBe(2)
    expect(summary.self).toEqual([
      { frame: 'work packages/editor/src/example.ts:3', sampledMs: 2, percentOfActive: 100 },
    ])
    expect(summary.inclusive).toContainEqual({
      frame: '(root)',
      sampledMs: 2,
      percentOfActive: 100,
    })
    expect(summary.inclusive).toHaveLength(2)
    expect(summary.inclusive.every((frame) => frame.percentOfActive === 100)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function writeProfile(directory) {
  await mkdir(resolve(directory, 'build/assets'), { recursive: true })
  await writeFile(
    resolve(directory, 'build/assets/test.js.map'),
    JSON.stringify({
      version: 3,
      sources: ['../../../packages/editor/src/example.ts'],
      sourcesContent: ['\n\nfunction work() {}'],
      names: [],
      mappings: 'AAEA',
    }),
  )
  const frame = {
    functionName: 'work',
    url: 'http://localhost:4173/assets/test.js',
    lineNumber: 0,
    columnNumber: 0,
  }
  await writeFile(
    resolve(directory, 'test.cpuprofile'),
    JSON.stringify({
      startTime: 0,
      endTime: 10000,
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2, 3] },
        { id: 2, callFrame: { functionName: '(idle)', url: '' } },
        { id: 3, callFrame: frame, children: [4] },
        { id: 4, callFrame: frame },
      ],
      samples: [2, 3, 4],
      timeDeltas: [8000, 1000, 1000],
    }),
  )
}
