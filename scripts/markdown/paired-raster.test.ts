import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PNG } from 'pngjs'
import { expect, test } from 'vitest'
import { VISUAL_STORY_IDS, WEBKIT_CRITICAL_IDS } from '../../packages/markdown/test/fixtures/cases'
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

function matrixLog(
  engine: Visual['engine'],
  screenshot: string,
  browser = 'chromium',
  stories: readonly string[] = VISUAL_STORY_IDS,
): string {
  const profiles = [
    { width: 390, theme: 'light' },
    { width: 390, theme: 'dark' },
    { width: 1440, theme: 'light' },
    { width: 1440, theme: 'dark' },
  ]
  return profiles
    .flatMap((profile) => {
      const base = { engine, browser, ...profile }
      const images = stories.map(
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

test('the exact promotion matrix combines Chromium 128 and critical WebKit 32 with 16 calibrations', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-combined-raster-'))
  try {
    const png = new PNG({ width: 4, height: 4 })
    png.data.fill(255)
    png.data.fill(0, 0, 32)
    const screenshot = path.join(root, 'content.png')
    await writeFile(screenshot, PNG.sync.write(png))
    const log = (engine: Visual['engine']) =>
      matrixLog(engine, screenshot).concat(
        '\n',
        matrixLog(engine, screenshot, 'webkit', WEBKIT_CRITICAL_IDS),
      )
    const report = await compareRasterEvidence(log('remark'), log('tree-sitter'), root, root)
    expect(report.findings).toEqual([])
    expect(report.status).toBe('passed')
    expect(report.compared).toHaveLength(160)
    expect(report.compared.filter((row) => row.key.includes('"webkit"'))).toHaveLength(32)
    const superset = (engine: Visual['engine']) =>
      matrixLog(engine, screenshot).concat('\n', matrixLog(engine, screenshot, 'webkit'))
    const selected = await compareRasterEvidence(
      superset('remark'),
      superset('tree-sitter'),
      root,
      root,
      'promotion',
    )
    expect(selected.status).toBe('passed')
    expect(selected.compared).toHaveLength(160)
    expect(selected.omittedStates.baseline).toHaveLength(96)
    expect(selected.omittedStates.candidate).toHaveLength(96)
    const supplemental = VISUAL_STORY_IDS.find(
      (id) => !WEBKIT_CRITICAL_IDS.some((critical) => critical === id),
    )
    if (!supplemental) throw new TypeError('Missing supplemental WebKit story')
    const invalidOmission = matrixLog('tree-sitter', screenshot).concat(
      '\n',
      matrixLog('tree-sitter', screenshot, 'webkit').replace(supplemental, 'undeclared-fixture'),
    )
    expect(
      (await compareRasterEvidence(superset('remark'), invalidOmission, root, root, 'promotion'))
        .status,
    ).toBe('failed')
    expect(
      (
        await compareRasterEvidence(
          matrixLog('remark', screenshot),
          matrixLog('tree-sitter', screenshot),
          root,
          root,
          'promotion',
        )
      ).status,
    ).toBe('failed')
    const missing = log('tree-sitter')
      .split('\n')
      .filter((_, index) => index !== 129)
      .join('\n')
    expect((await compareRasterEvidence(log('remark'), missing, root, root)).status).toBe('failed')
    const excess = matrixLog('tree-sitter', screenshot).concat(
      '\n',
      matrixLog('tree-sitter', screenshot, 'webkit'),
    )
    expect((await compareRasterEvidence(log('remark'), excess, root, root)).status).toBe('failed')
    const calibration =
      log('tree-sitter')
        .split('\n')
        .find((line) => line.includes('CALIBRATION')) ?? ''
    const duplicate = log('tree-sitter').concat('\n', calibration)
    expect((await compareRasterEvidence(log('remark'), duplicate, root, root)).status).toBe(
      'failed',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('critical-only WebKit captures can be compared before joining Chromium evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-critical-raster-'))
  try {
    const png = new PNG({ width: 4, height: 4 })
    png.data.fill(255)
    png.data.fill(0, 0, 32)
    const screenshot = path.join(root, 'content.png')
    await writeFile(screenshot, PNG.sync.write(png))
    const report = await compareRasterEvidence(
      matrixLog('remark', screenshot, 'webkit', WEBKIT_CRITICAL_IDS),
      matrixLog('tree-sitter', screenshot, 'webkit', WEBKIT_CRITICAL_IDS),
      root,
      root,
    )
    expect(report.status).toBe('passed')
    expect(report.compared).toHaveLength(32)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('retained raster map reads original remote identities without rewriting logs or merging equal images', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'markdown-retained-raster-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'markdown-outside-raster-'))
  try {
    const png = new PNG({ width: 4, height: 4 })
    png.data.fill(255)
    png.data.fill(0, 0, 32)
    const bytes = PNG.sync.write(png)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const original = {
      baseline: '/capture-host/remark.png',
      candidate: '/other-host/candidate.png',
    }
    await writeFile(path.join(root, 'remark.png'), bytes)
    await writeFile(path.join(root, 'candidate.png'), bytes)
    const entries = [
      { original: original.baseline, file: 'remark.png', sha256 },
      { original: original.candidate, file: 'candidate.png', sha256 },
    ]
    const imageMap = path.join(root, 'images.json')
    const save = (images: typeof entries) =>
      writeFile(imageMap, JSON.stringify({ schemaVersion: 1, images }))
    await save(entries)
    const first = matrixLog('remark', original.baseline)
    const second = matrixLog('tree-sitter', original.candidate)
    const compare = () =>
      compareRasterEvidence(first, second, root, path.join(root, 'paired'), 'all', imageMap)
    const result = await compare()
    expect(result.status).toBe('passed')
    expect(result.imageMap?.images).toEqual(entries)
    expect(result.imageMap?.sha256).toBe(
      createHash('sha256')
        .update(await readFile(imageMap))
        .digest('hex'),
    )
    await save(entries.slice(0, 1))
    await expect(compare()).rejects.toThrow()
    await save(entries.concat(entries.slice(0, 1)))
    await expect(compare()).rejects.toThrow()
    await save(entries.map((entry) => ({ ...entry, file: 'remark.png' })))
    await expect(compare()).rejects.toThrow()
    await save(entries.map((entry) => ({ ...entry, sha256: '0'.repeat(64) })))
    await expect(compare()).rejects.toThrow()
    await writeFile(path.join(outside, 'outside.png'), bytes)
    await symlink(outside, path.join(root, 'escape'))
    await save(entries.map((entry) => ({ ...entry, file: 'escape/outside.png' })))
    await expect(compare()).rejects.toThrow(
      'Raster image map files must stay inside the evidence root.',
    )
    await save(entries)
    const supplementalId = VISUAL_STORY_IDS.find(
      (fixture) => !WEBKIT_CRITICAL_IDS.some((id) => id === fixture),
    )
    expect(supplementalId).toBeDefined()
    if (!supplementalId) throw new TypeError('Missing supplemental WebKit story')
    const supplemental = matrixLog('tree-sitter', '/capture-host/supplemental.png', 'webkit', [
      supplementalId,
    ])
    await expect(
      compareRasterEvidence(first, second + '\n' + supplemental, root, root, 'promotion', imageMap),
    ).rejects.toThrow(
      'Raster image mapping must cover every original visual and calibration reference.',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
