import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PNG } from 'pngjs'
import { VISUAL_STORY_IDS } from '../../packages/markdown/test/fixtures/cases'
import { createScriptError } from '../structured-errors'
import {
  negativeControls,
  nonblankPixels,
  pixelDifference,
  rasterRecords,
  readBitmap,
  type Bitmap,
  type Calibration,
  type Visual,
} from './raster'

function profileKey(image: Pick<Visual, 'browser' | 'width' | 'theme'>): string {
  return JSON.stringify([image.browser, image.width, image.theme])
}

function visualKey(image: Visual): string {
  return JSON.stringify([image.fixture, image.browser, image.width, image.theme])
}

export function pairVisuals(baseline: readonly Visual[], candidate: readonly Visual[]) {
  const findings: string[] = []
  const first = indexVisuals(baseline, 'remark', findings)
  const second = indexVisuals(candidate, 'tree-sitter', findings)
  const pairs: { baseline: Visual; candidate: Visual }[] = []
  for (const [key, image] of first) {
    const other = second.get(key)
    if (!other) findings.push(`Candidate is missing visual state ${key}.`)
    else pairs.push({ baseline: image, candidate: other })
  }
  for (const key of second.keys()) {
    if (!first.has(key)) findings.push(`Baseline is missing visual state ${key}.`)
  }
  return { pairs, findings }
}

function indexVisuals(
  images: readonly Visual[],
  engine: Visual['engine'],
  findings: string[],
): Map<string, Visual> {
  const index = new Map<string, Visual>()
  for (const image of images) {
    const key = visualKey(image)
    if (image.engine !== engine) findings.push(`Expected ${engine} for visual state ${key}.`)
    if (index.has(key)) findings.push(`Duplicate ${engine} visual state ${key}.`)
    index.set(key, image)
  }
  return index
}

export function differenceOverlay(first: Bitmap, second: Bitmap): Bitmap {
  const width = Math.max(first.width, second.width)
  const height = Math.max(first.height, second.height)
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      markPixel(first, second, data, width, x, y)
    }
  }
  return { width, height, data }
}

function markPixel(
  first: Bitmap,
  second: Bitmap,
  output: Uint8Array,
  width: number,
  x: number,
  y: number,
) {
  const offset = (y * width + x) * 4
  const firstOffset = (y * first.width + x) * 4
  const secondOffset = (y * second.width + x) * 4
  const present = x < first.width && x < second.width && y < first.height && y < second.height
  const same =
    present &&
    [0, 1, 2, 3].every(
      (channel) => first.data[firstOffset + channel] === second.data[secondOffset + channel],
    )
  if (!same) {
    output.set([255, 0, 70, 255], offset)
    return
  }
  output.set(first.data.subarray(firstOffset, firstOffset + 4), offset)
}

async function calibrationTolerances(
  records: readonly Calibration[],
  root: string,
  engine: Visual['engine'],
  findings: string[],
) {
  const tolerances = new Map<string, number>()
  for (const record of records) {
    const key = profileKey(record)
    if (record.engine !== engine || tolerances.has(key))
      findings.push(`Invalid or duplicate ${engine} raster calibration ${key}.`)
    const first = await readBitmap(record.first, root)
    const second = await readBitmap(record.repeated, root)
    const difference = pixelDifference(first, second)
    if (difference.status !== 'compared' || difference.ratio > 0.001)
      findings.push(`${engine} raster calibration is unstable for ${key}.`)
    tolerances.set(key, difference.ratio)
  }
  if (tolerances.size !== 4) findings.push(`${engine} needs four calibrated visual profiles.`)
  return tolerances
}

function matrixFindings(images: readonly Visual[]): string[] {
  const profiles = new Map<string, Visual[]>()
  for (const image of images) {
    const key = profileKey(image)
    const group = profiles.get(key) ?? []
    group.push(image)
    profiles.set(key, group)
  }
  const complete =
    profiles.size === 4 &&
    Array.from(profiles.values()).every(
      (group) =>
        group.length === VISUAL_STORY_IDS.length &&
        VISUAL_STORY_IDS.every((id) => group.some((image) => image.fixture === id)),
    )
  const widths = new Set(images.map((image) => image.width))
  const themes = new Set(images.map((image) => image.theme))
  const browsers = new Set(images.map((image) => image.browser))
  return complete &&
    widths.size === 2 &&
    widths.has(390) &&
    widths.has(1440) &&
    themes.size === 2 &&
    themes.has('light') &&
    themes.has('dark') &&
    browsers.size === 1
    ? []
    : ['The paired visual matrix needs all 32 stories in four profiles on the same browser.']
}

export async function compareRasterEvidence(
  baselineLog: string,
  candidateLog: string,
  root: string,
  output: string,
) {
  const baseline = rasterRecords(baselineLog)
  const candidate = rasterRecords(candidateLog)
  const { pairs, findings } = pairVisuals(baseline.images, candidate.images)
  findings.push(...matrixFindings(baseline.images), ...matrixFindings(candidate.images))
  const firstTolerance = await calibrationTolerances(baseline.calibration, root, 'remark', findings)
  const secondTolerance = await calibrationTolerances(
    candidate.calibration,
    root,
    'tree-sitter',
    findings,
  )
  const directory = path.join(output, 'images')
  await mkdir(directory, { recursive: true })
  const compared = []
  for (const [index, pair] of pairs.entries()) {
    const first = await readBitmap(pair.baseline.screenshot, root)
    const second = await readBitmap(pair.candidate.screenshot, root)
    const difference = pixelDifference(first, second)
    const key = profileKey(pair.baseline)
    const calibrated = firstTolerance.has(key) && secondTolerance.has(key)
    const tolerance = Math.max(firstTolerance.get(key) ?? 0, secondTolerance.get(key) ?? 0)
    const status =
      calibrated &&
      difference.status === 'compared' &&
      difference.ratio <= tolerance &&
      nonblankPixels(first) >= 8 &&
      nonblankPixels(second) >= 8
        ? 'passed'
        : 'failed'
    const filenames = {
      baseline: `${index}-remark.png`,
      candidate: `${index}-tree-sitter.png`,
      overlay: `${index}-overlay.png`,
    }
    await writeBitmap(path.join(directory, filenames.baseline), first)
    await writeBitmap(path.join(directory, filenames.candidate), second)
    await writeBitmap(path.join(directory, filenames.overlay), differenceOverlay(first, second))
    compared.push({
      key: visualKey(pair.baseline),
      ...difference,
      status,
      tolerance,
      baseline: `images/${filenames.baseline}`,
      candidate: `images/${filenames.candidate}`,
      overlay: `images/${filenames.overlay}`,
    })
  }
  const controlsPassed = negativeControls()
  return {
    comparison: 'paired-completed-message-raster',
    compared,
    findings,
    controlsPassed,
    unexplainedChangedStates: compared.filter((row) => row.status === 'failed').length,
    status:
      findings.length === 0 && controlsPassed && compared.every((row) => row.status === 'passed')
        ? 'passed'
        : 'failed',
  }
}

async function writeBitmap(file: string, bitmap: Bitmap) {
  const png = new PNG({ width: bitmap.width, height: bitmap.height })
  png.data.set(bitmap.data)
  await writeFile(file, PNG.sync.write(png))
}

async function main() {
  const { values } = parseArgs({
    options: {
      'baseline-log': { type: 'string' },
      'candidate-log': { type: 'string' },
      root: { type: 'string', default: path.resolve(import.meta.dirname, '../..') },
      out: { type: 'string' },
    },
  })
  if (!values['baseline-log'] || !values['candidate-log'] || !values.out)
    throw createScriptError('Choose both engine logs and --out DIRECTORY.', {
      internal: { field: 'arguments' },
    })
  const baseline = await readFile(values['baseline-log'], 'utf8')
  const candidate = await readFile(values['candidate-log'], 'utf8')
  const report = await compareRasterEvidence(baseline, candidate, values.root, values.out)
  await writeFile(
    path.join(values.out, 'paired-raster.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ evidence: values.out, status: report.status, compared: report.compared.length, changed: report.unexplainedChangedStates, findings: report.findings })}\n`,
  )
  process.exitCode = report.status === 'passed' ? 0 : 1
}

if (import.meta.main) await main()
