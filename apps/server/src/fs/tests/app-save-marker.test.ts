import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { consumeAppSave, forgetAppSave, recordAppSave } from '../app-save-marker'

describe('app save markers', () => {
  it('records a path and consumes it once', async () => {
    const markerPath = await temporaryMarkerPath()
    const savedPath = path.join(tmpdir(), 'platform-source-file.ts')

    expect(recordAppSave(savedPath, { markerPath, now: 1_000 })).toBe(true)
    expect(consumeAppSave(savedPath, { markerPath, now: 1_001 })).toBe(true)
    expect(consumeAppSave(savedPath, { markerPath, now: 1_002 })).toBe(false)
    expect(await readdir(path.dirname(markerPath))).toEqual(['markers.json'])
  })

  it('expires stale markers', async () => {
    const markerPath = await temporaryMarkerPath()
    const savedPath = path.join(tmpdir(), 'platform-stale-source-file.ts')

    recordAppSave(savedPath, { markerPath, now: 1_000, ttlMs: 50 })

    expect(consumeAppSave(savedPath, { markerPath, now: 1_100, ttlMs: 50 })).toBe(false)
  })

  it('forgets a marker after a failed save', async () => {
    const markerPath = await temporaryMarkerPath()
    const savedPath = path.join(tmpdir(), 'platform-failed-source-file.ts')

    recordAppSave(savedPath, { markerPath, now: 1_000 })
    forgetAppSave(savedPath, { markerPath })

    expect(consumeAppSave(savedPath, { markerPath, now: 1_001 })).toBe(false)
  })
})

async function temporaryMarkerPath() {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-save-marker-'))
  return path.join(directory, 'markers.json')
}
