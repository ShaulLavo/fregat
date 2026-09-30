import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const UNICODE_VERSION = '17.0.0'
const SOURCE_URL = `https://www.unicode.org/Public/${UNICODE_VERSION}/ucd/extracted/DerivedBidiClass.txt`
const SOURCE_SHA256 = '4867b4b7f0731ed1bfcd34cc6251211ff1542541fce0734b6fbda139ee80b3a4'
const SOURCE_PATH = new URL(`./unicode/DerivedBidiClass-${UNICODE_VERSION}.txt`, import.meta.url)
const OUTPUT_PATH = new URL('../src/virtualization/bidiClassData.ts', import.meta.url)
const CODE_POINT_COUNT = 0x110000
const EXPECTED_RTL_CODE_POINT_COUNT = 5_362
const EXPECTED_RTL_RANGE_COUNT = 60
const RTL_CLASSES = new Set(['R', 'AL', 'Right_To_Left', 'Arabic_Letter'])
const MISSING_LINE = /^# @missing: ([0-9A-F]+)(?:\.\.([0-9A-F]+))?; (\w+)$/
const DATA_LINE = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s+;\s+(\w+)/

function parseRange(match) {
  const start = Number.parseInt(match[1], 16)
  const end = Number.parseInt(match[2] ?? match[1], 16)
  return { start, end, bidiClass: match[3] }
}

function parseSource(source) {
  const missing = []
  const assigned = []
  for (const line of source.split('\n')) {
    const missingMatch = MISSING_LINE.exec(line)
    if (missingMatch) {
      missing.push(parseRange(missingMatch))
      continue
    }

    const dataMatch = DATA_LINE.exec(line)
    if (dataMatch) assigned.push(parseRange(dataMatch))
  }
  return { missing, assigned }
}

function applyRanges(values, ranges) {
  for (const range of ranges) {
    const value = RTL_CLASSES.has(range.bidiClass) ? 1 : 0
    values.fill(value, range.start, range.end + 1)
  }
}

function collectRanges(values) {
  const ranges = []
  let start = null
  for (let codePoint = 0; codePoint <= values.length; codePoint += 1) {
    const isRTL = values[codePoint] === 1
    if (isRTL && start === null) {
      start = codePoint
      continue
    }
    if (isRTL || start === null) continue

    ranges.push({ start, end: codePoint - 1 })
    start = null
  }
  return ranges
}

function escapeCodePoint(codePoint) {
  return `\\u{${codePoint.toString(16).toUpperCase()}}`
}

function formatRange(range) {
  const start = escapeCodePoint(range.start)
  if (range.start === range.end) return start
  return `${start}-${escapeCodePoint(range.end)}`
}

function verifyRanges(ranges) {
  const codePointCount = ranges.reduce((count, range) => count + range.end - range.start + 1, 0)
  if (codePointCount !== EXPECTED_RTL_CODE_POINT_COUNT) {
    throw new Error(
      `Unicode RTL code-point count mismatch: expected ${EXPECTED_RTL_CODE_POINT_COUNT}, received ${codePointCount}`,
    )
  }
  if (ranges.length === EXPECTED_RTL_RANGE_COUNT) return
  throw new Error(
    `Unicode RTL range count mismatch: expected ${EXPECTED_RTL_RANGE_COUNT}, received ${ranges.length}`,
  )
}

function generatedSource(source) {
  const { missing, assigned } = parseSource(source)
  const values = new Uint8Array(CODE_POINT_COUNT)
  applyRanges(values, missing)
  applyRanges(values, assigned)

  const ranges = collectRanges(values)
  verifyRanges(ranges)
  const pattern = ranges.map(formatRange).join('')
  return `/** Generated from Unicode ${UNICODE_VERSION} DerivedBidiClass.txt.\n * Source: ${SOURCE_URL}\n * License: scripts/unicode/LICENSE.txt (published with @singapore-editor/core).\n * Run \`bun run bidi:generate\` to update.\n */\nexport const RTL_BIDI_CHARACTER =\n  /[${pattern}]/u\n`
}

function verifySource(source) {
  const checksum = createHash('sha256').update(source).digest('hex')
  if (checksum !== SOURCE_SHA256) {
    throw new Error(
      `Unicode source checksum mismatch: expected ${SOURCE_SHA256}, received ${checksum}`,
    )
  }

  const expectedHeader = `# DerivedBidiClass-${UNICODE_VERSION}.txt`
  if (source.startsWith(expectedHeader)) return
  throw new Error(`Unicode source version mismatch: expected ${expectedHeader}`)
}

async function checkOutput(generated) {
  let current = ''
  try {
    current = await readFile(OUTPUT_PATH, 'utf8')
  } catch {}
  if (current === generated) return

  console.error('Generated BiDi-class data is stale. Run `bun run bidi:generate`.')
  process.exitCode = 1
}

async function main() {
  const source = await readFile(SOURCE_PATH, 'utf8')
  verifySource(source)
  const generated = generatedSource(source)
  if (process.argv.includes('--check')) {
    await checkOutput(generated)
    return
  }
  await writeFile(OUTPUT_PATH, generated)
}

await main()
