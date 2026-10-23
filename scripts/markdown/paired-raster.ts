import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { PNG } from 'pngjs'
import * as v from 'valibot'
import { VISUAL_STORY_IDS, WEBKIT_CRITICAL_IDS } from '../../packages/markdown/test/fixtures/cases'
import { createScriptError } from '../structured-errors'
import {
  negativeControls,
  nonblankPixels,
  pixelDifference,
  rasterRecords,
  visualProfileKeys,
  readBitmap,
  type Bitmap,
  type Calibration,
  type Visual,
} from './raster'

const rasterImageMap = v.strictObject({
  schemaVersion: v.literal(1),
  images: v.array(
    v.strictObject({
      original: v.pipe(v.string(), v.minLength(1)),
      file: v.pipe(v.string(), v.minLength(1)),
      sha256: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)),
    }),
  ),
})
type RetainedImage = v.InferOutput<typeof rasterImageMap>['images'][number]
type RasterImageReader = (original: string) => Promise<Bitmap>

async function evidenceFile(root: string, file: string) {
  const resolved = await realpath(path.resolve(root, file))
  if (!resolved.startsWith(root + path.sep))
    throw createScriptError('Raster image map files must stay inside the evidence root.')
  return resolved
}

function rasterImageReferences(log: string) {
  const { images, calibration } = rasterRecords(log)
  return images
    .map((image) => image.screenshot)
    .concat(calibration.flatMap((record) => [record.first, record.repeated]))
}

async function retainedBitmap(root: string, image: RetainedImage): Promise<Bitmap> {
  const bytes = await readFile(await evidenceFile(root, image.file))
  if (createHash('sha256').update(bytes).digest('hex') !== image.sha256)
    throw createScriptError('Retained raster image bytes differ from their mapping.')
  return PNG.sync.read(bytes)
}

async function rasterImageAccess(
  root: string,
  references: readonly string[],
  mapFile: string | undefined,
) {
  if (!mapFile) return { read: (file: string) => readBitmap(file, root), receipt: null }
  const canonicalRoot = await realpath(root)
  const file = await evidenceFile(canonicalRoot, mapFile)
  const bytes = await readFile(file)
  const parsed = v.parse(rasterImageMap, JSON.parse(bytes.toString('utf8')))
  const expected = new Set(references)
  const images = new Map<string, RetainedImage>()
  const retained = new Set<string>()
  for (const image of parsed.images) {
    const physical = await stat(await evidenceFile(canonicalRoot, image.file), { bigint: true })
    const identity = `${physical.dev}:${physical.ino}`
    if (
      !path.isAbsolute(image.original) ||
      images.has(image.original) ||
      retained.has(identity) ||
      !expected.has(image.original) ||
      path.isAbsolute(image.file)
    )
      throw createScriptError(
        'Raster image mappings require distinct original and retained identities.',
      )
    images.set(image.original, image)
    retained.add(identity)
    await retainedBitmap(canonicalRoot, image)
  }
  if (images.size !== expected.size)
    throw createScriptError(
      'Raster image mapping must cover every original visual and calibration reference.',
    )
  const read: RasterImageReader = (original) => {
    const image = images.get(original)
    if (!image) throw createScriptError('Original raster image has no retained mapping.')
    return retainedBitmap(canonicalRoot, image)
  }
  return {
    read,
    receipt: {
      path: path.relative(canonicalRoot, file),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      images: parsed.images,
    },
  }
}

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
  read: RasterImageReader,
  engine: Visual['engine'],
  images: readonly Visual[],
  findings: string[],
) {
  const profiles = new Set(images.map(profileKey))
  const tolerances = new Map<string, number>()
  for (const record of records) {
    const key = profileKey(record)
    if (record.engine !== engine || tolerances.has(key))
      findings.push(`Invalid or duplicate ${engine} raster calibration ${key}.`)
    const first = await read(record.first)
    const second = await read(record.repeated)
    const difference = pixelDifference(first, second)
    if (difference.status !== 'compared' || difference.ratio > 0.001)
      findings.push(`${engine} raster calibration is unstable for ${key}.`)
    tolerances.set(key, difference.ratio)
  }
  if (
    tolerances.size !== profiles.size ||
    !Array.from(profiles).every((key) => tolerances.has(key))
  )
    findings.push(`${engine} needs exactly one calibration for each browser, width and theme.`)
  return tolerances
}

function matrixFindings(images: readonly Visual[]): string[] {
  const browsers = new Set(images.map((image) => image.browser))
  const keys = new Set(images.map(visualKey))
  const expected = Array.from(browsers).flatMap((browser) => {
    const fullWebkit =
      browsers.size === 1 && browser === 'webkit' && images.length === VISUAL_STORY_IDS.length * 4
    const stories = browser === 'chromium' || fullWebkit ? VISUAL_STORY_IDS : WEBKIT_CRITICAL_IDS
    return stories.flatMap((fixture) => visualProfileKeys(fixture, browser))
  })
  return browsers.size > 0 &&
    Array.from(browsers).every((browser) => browser === 'chromium' || browser === 'webkit') &&
    images.length === expected.length &&
    keys.size === expected.length &&
    expected.every((key) => keys.has(key))
    ? []
    : [
        'The paired visual matrix needs Chromium 128 and critical WebKit 32 states, or one complete browser matrix.',
      ]
}

export async function compareRasterEvidence(
  baselineLog: string,
  candidateLog: string,
  root: string,
  output: string,
  selection: 'all' | 'promotion' = 'all',
  imageMapFile?: string,
) {
  const access = await rasterImageAccess(
    root,
    rasterImageReferences(baselineLog).concat(rasterImageReferences(candidateLog)),
    imageMapFile,
  )
  const baseline = selectRasterRecords(baselineLog, selection)
  const candidate = selectRasterRecords(candidateLog, selection)
  const { pairs, findings } = pairVisuals(baseline.images, candidate.images)
  findings.push(...matrixFindings(baseline.images), ...matrixFindings(candidate.images))
  if (selection === 'promotion')
    findings.push(
      ...omittedRasterFindings(baseline.omitted),
      ...omittedRasterFindings(candidate.omitted),
    )
  if (
    selection === 'promotion' &&
    (baseline.images.length !== 160 || candidate.images.length !== 160)
  )
    findings.push(
      'Promotion requires exactly 128 Chromium and 32 critical WebKit states for each engine.',
    )
  const firstTolerance = await calibrationTolerances(
    baseline.calibration,
    access.read,
    'remark',
    baseline.images,
    findings,
  )
  const secondTolerance = await calibrationTolerances(
    candidate.calibration,
    access.read,
    'tree-sitter',
    candidate.images,
    findings,
  )
  const directory = path.join(output, 'images')
  await mkdir(directory, { recursive: true })
  const compared = []
  for (const [index, pair] of pairs.entries()) {
    const first = await access.read(pair.baseline.screenshot)
    const second = await access.read(pair.candidate.screenshot)
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
    imageMap: access.receipt,
    selection,
    selectedStates: {
      baseline: baseline.images.map(visualKey),
      candidate: candidate.images.map(visualKey),
    },
    omittedStates: { baseline: baseline.omitted, candidate: candidate.omitted },
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

function selectRasterRecords(log: string, selection: 'all' | 'promotion') {
  const records = rasterRecords(log)
  if (selection === 'all') return { ...records, omitted: [] }
  const critical = new Set<string>(WEBKIT_CRITICAL_IDS)
  const included = (image: Visual) => image.browser !== 'webkit' || critical.has(image.fixture)
  return {
    ...records,
    images: records.images.filter(included),
    omitted: records.images.filter((image) => !included(image)).map(visualKey),
  }
}

function omittedRasterFindings(omitted: readonly string[]): string[] {
  if (omitted.length === 0) return []
  const critical = new Set<string>(WEBKIT_CRITICAL_IDS)
  const expected = VISUAL_STORY_IDS.filter((fixture) => !critical.has(fixture)).flatMap((fixture) =>
    visualProfileKeys(fixture, 'webkit'),
  )
  const actual = new Set(omitted)
  return omitted.length === expected.length &&
    actual.size === expected.length &&
    expected.every((key) => actual.has(key))
    ? []
    : [
        'Omitted WebKit rows must be exactly the declared 96 supplemental states from one full browser matrix.',
      ]
}

async function writeBitmap(file: string, bitmap: Bitmap) {
  const png = new PNG({ width: bitmap.width, height: bitmap.height })
  png.data.set(bitmap.data)
  await writeFile(file, PNG.sync.write(png))
}

async function main() {
  const { values } = parseArgs({
    options: {
      'baseline-log': { type: 'string', multiple: true },
      'candidate-log': { type: 'string', multiple: true },
      promotion: { type: 'boolean', default: false },
      'image-map': { type: 'string' },
      root: { type: 'string', default: path.resolve(import.meta.dirname, '../..') },
      out: { type: 'string' },
    },
  })
  if (!values['baseline-log'] || !values['candidate-log'] || !values.out)
    throw createScriptError('Choose both engine logs and --out DIRECTORY.', {
      internal: { field: 'arguments' },
    })
  const baseline = await readRasterLogs(values['baseline-log'])
  const candidate = await readRasterLogs(values['candidate-log'])
  const report = {
    ...(await compareRasterEvidence(
      baseline.contents,
      candidate.contents,
      values.root,
      values.out,
      values.promotion ? 'promotion' : 'all',
      values['image-map'],
    )),
    sourceLogs: { baseline: baseline.files, candidate: candidate.files },
  }
  await writeFile(
    path.join(values.out, 'paired-raster.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ evidence: values.out, status: report.status, compared: report.compared.length, changed: report.unexplainedChangedStates, findings: report.findings })}\n`,
  )
  process.exitCode = report.status === 'passed' ? 0 : 1
}

async function readRasterLogs(paths: readonly string[]) {
  const logs = await Promise.all(
    paths.map(async (file) => {
      const contents = await readFile(file, 'utf8')
      return { path: file, contents, sha256: createHash('sha256').update(contents).digest('hex') }
    }),
  )
  return {
    contents: logs.map((log) => log.contents).join('\n'),
    files: logs.map(({ path, sha256 }) => ({ path, sha256 })),
  }
}

if (import.meta.main) await main()
