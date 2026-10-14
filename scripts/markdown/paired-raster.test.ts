import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { expect, test } from 'vitest'
import { VISUAL_STORY_IDS } from '../../packages/markdown/test/fixtures/cases'
import { compareRasterEvidence, differenceOverlay, pairVisuals } from './paired-raster'
import type { Visual } from './raster'

function visual(engine: Visual['engine'], fixture = 'story'): Visual {
  return {
    engine,
    fixture,
    browser: 'chromium',
    width: 390,
    theme: 'dark',
    screenshot: 'image.png',
  }
}

test('visual pairs require the same fixture, browser, width, and theme', () => {
  const baseline = visual('remark')
  const candidate = visual('tree-sitter')
  expect(pairVisuals([baseline], [candidate])).toEqual({
    findings: [],
    pairs: [{ baseline, candidate }],
  })
  const result = pairVisuals([baseline], [{ ...candidate, theme: 'light' }])
  expect(result.pairs).toHaveLength(0)
  expect(result.findings).toHaveLength(2)
})

test('duplicate screenshots and false engine labels remain failures', () => {
  expect(
    pairVisuals([visual('remark'), visual('remark')], [visual('tree-sitter')]).findings,
  ).toContainEqual(expect.stringContaining('Duplicate'))
  expect(pairVisuals([visual('tree-sitter')], [visual('tree-sitter')]).findings).toContainEqual(
    expect.stringContaining('Expected remark'),
  )
})

test('overlays retain equal pixels and mark changed pixels independently of content counts', () => {
  const first = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }
  const second = { ...first, data: new Uint8Array([0, 0, 0, 255, 255, 254, 255, 255]) }
  expect(differenceOverlay(first, second).data).toEqual(
    new Uint8Array([0, 0, 0, 255, 255, 0, 70, 255]),
  )
  expect(differenceOverlay(first, first).data).toEqual(first.data)
})

test('overlays mark additional layout area when raster dimensions differ', () => {
  const first = { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]) }
  const second = { width: 2, height: 1, data: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]) }
  expect(differenceOverlay(first, second)).toEqual({
    width: 2,
    height: 1,
    data: new Uint8Array([0, 0, 0, 255, 255, 0, 70, 255]),
  })
})

function matrixLog(engine: Visual['engine'], screenshot: string): string {
  const profiles = [
    { width: 390, theme: 'light' },
    { width: 390, theme: 'dark' },
    { width: 1440, theme: 'light' },
    { width: 1440, theme: 'dark' },
  ]
  return profiles
    .flatMap((profile) => {
      const base = { engine, browser: 'chromium', ...profile }
      const images = VISUAL_STORY_IDS.map(
        (fixture) => 'MARKDOWN_BROWSER_VISUAL ' + JSON.stringify({ ...base, fixture, screenshot }),
      )
      return images.concat([
        'MARKDOWN_BROWSER_CALIBRATION ' +
          JSON.stringify({
            ...base,
            fixture: VISUAL_STORY_IDS[0],
            first: screenshot,
            repeated: screenshot,
          }),
      ])
    })
    .join('\n')
}

test('real PNG matrix comparison rejects a color change after stable self calibration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-paired-raster-'))
  try {
    const png = new PNG({ width: 4, height: 4 })
    png.data.fill(255)
    png.data.fill(0, 0, 32)
    const baseline = path.join(root, 'remark.png')
    const candidate = path.join(root, 'candidate.png')
    await writeFile(baseline, PNG.sync.write(png))
    await writeFile(candidate, PNG.sync.write(png))
    const first = matrixLog('remark', baseline)
    const second = matrixLog('tree-sitter', candidate)
    const same = await compareRasterEvidence(first, second, root, path.join(root, 'same'))
    expect(same.status).toBe('passed')
    expect(same.compared).toHaveLength(128)
    const invalidProfiles = (log: string) =>
      log
        .replaceAll('"width":390', '"width":111')
        .replaceAll('"width":1440', '"width":222')
        .replaceAll('"theme":"light"', '"theme":"bogus-light"')
        .replaceAll('"theme":"dark"', '"theme":"bogus-dark"')
    const invalid = await compareRasterEvidence(
      invalidProfiles(first),
      invalidProfiles(second),
      root,
      path.join(root, 'invalid'),
    )
    expect(invalid.status).toBe('failed')
    expect(invalid.findings).toHaveLength(2)
    png.data[0] = 1
    await writeFile(candidate, PNG.sync.write(png))
    const changed = await compareRasterEvidence(first, second, root, path.join(root, 'changed'))
    expect(changed.status).toBe('failed')
    expect(changed.unexplainedChangedStates).toBe(128)
    expect(changed.findings).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
