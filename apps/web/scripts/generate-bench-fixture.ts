import { closeSync, mkdirSync, openSync, readSync, writeFileSync, type PathLike } from 'node:fs'
import { dirname, resolve } from 'node:path'

const defaultLines = 1_000_000
const defaultOutput = resolve(process.cwd(), '../../.bench-fixtures/huge.ts')
const options = parseOptions(process.argv.slice(2))

const existing = existingFixture(options.output, options.lines)
if (existing) {
  console.log(`BENCH_FIXTURE_READY ${options.output} (${existing.lines} lines, cached)`)
  process.exit(0)
}

const startedAt = performance.now()
const content = generateFixture(options.lines)
mkdirSync(dirname(options.output), { recursive: true })
writeFileSync(options.output, content)
const elapsed = Math.round(performance.now() - startedAt)
console.log(
  `BENCH_FIXTURE_READY ${options.output} (${options.lines} lines, ${content.length} bytes, ${elapsed}ms)`,
)

function parseOptions(args: readonly string[]) {
  const parsed = { lines: defaultLines, output: defaultOutput }
  for (const arg of args) {
    const [name, value] = arg.split('=')
    if (name === '--lines') parsed.lines = positiveInteger(value, parsed.lines)
    if (name === '--output') parsed.output = resolve(value ?? parsed.output)
  }

  return parsed
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback

  return parsed
}

function existingFixture(path: PathLike, lines: number) {
  const marker = fixtureMarker(lines)
  let descriptor
  try {
    descriptor = openSync(path, 'r')
  } catch {
    return null
  }

  const buffer = Buffer.alloc(marker.length)
  const bytesRead = readSync(descriptor, buffer, 0, marker.length, 0)
  closeSync(descriptor)
  if (buffer.toString('utf8', 0, bytesRead) !== marker) return null

  return { lines }
}

function fixtureMarker(lines: number) {
  return `// bench-fixture v1 lines=${lines}\n`
}

// Deterministic PRNG so every run benchmarks the identical document.
function createRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function generateFixture(lineTarget: number) {
  const random = createRandom(0x5eed)
  const parts = [fixtureMarker(lineTarget)]
  let lines = 1
  let blockIndex = 0

  while (lines < lineTarget) {
    const block = nextBlock(random, blockIndex++, lineTarget - lines)
    parts.push(block.text)
    lines += block.lines
  }

  return parts.join('')
}

function nextBlock(random: () => number, index: number, remaining: number) {
  const roll = random()
  if (remaining < 12) return commentBlock(index, remaining)
  if (roll < 0.3) return functionBlock(random, index)
  if (roll < 0.5) return interfaceBlock(random, index)
  if (roll < 0.65) return constArrayBlock(random, index)
  if (roll < 0.8) return classBlock(random, index)
  if (roll < 0.9) return chainedExpressionBlock(random, index)
  return commentBlock(index, 3)
}

function functionBlock(random: () => number, index: number) {
  const id = `transformSegment_${index}`
  const lines = [
    `export function ${id}(input: ReadonlyArray<number>, offset: number, scale: number): number {`,
    `  const filtered = input.filter((value) => value % ${pick(random, [3, 5, 7, 11])} !== 0 && value > offset)`,
    `  const accumulated = filtered.reduce((total, value) => total + value * ${pick(random, [13, 17, 31, 37])} + offset, ${pick(random, [0, 1, 7])})`,
    `  const normalized = Math.max(${pick(random, [0, 1])}, Math.min(accumulated * scale, Number.MAX_SAFE_INTEGER / ${pick(random, [2, 4, 8])}))`,
    `  return Math.round(normalized) ^ (offset << ${pick(random, [2, 3, 5])})`,
    '}',
    '',
  ]
  return { lines: lines.length, text: lines.join('\n') + '\n' }
}

function interfaceBlock(random: () => number, index: number) {
  const lines = [
    `export interface SegmentDescriptor_${index} {`,
    `  readonly id: string`,
    `  readonly kind: ${pick(random, ["'alpha' | 'beta' | 'gamma'", "'primary' | 'secondary'", "'leaf' | 'branch' | 'root'"])}`,
    `  readonly offsets: ReadonlyArray<number>`,
    `  readonly metadata: Readonly<Record<string, ${pick(random, ['string', 'number', 'boolean', 'unknown'])}>>`,
    `  readonly resolve: (path: string, depth: number) => Promise<SegmentDescriptor_${index} | null>`,
    '}',
    '',
  ]
  return { lines: lines.length, text: lines.join('\n') + '\n' }
}

function constArrayBlock(random: () => number, index: number) {
  const values = Array.from(
    { length: 8 },
    (_, i) =>
      `{ key: 'entry_${index}_${i}', weight: ${Math.floor(random() * 1000)}, enabled: ${random() > 0.5} }`,
  )
  const lines = [
    `export const segmentEntries_${index} = [`,
    ...values.map((value) => `  ${value},`),
    '] as const',
    '',
  ]
  return { lines: lines.length, text: lines.join('\n') + '\n' }
}

function classBlock(random: () => number, index: number) {
  const lines = [
    `export class SegmentProcessor_${index} {`,
    `  readonly #cache = new Map<string, number>()`,
    '',
    `  process(key: string, values: ReadonlyArray<number>): number {`,
    `    const cached = this.#cache.get(key)`,
    `    if (cached !== undefined) return cached * ${pick(random, [1, 2, 3])}`,
    '',
    `    const computed = values.reduce((total, value, idx) => total + value * idx + ${Math.floor(random() * 100)}, 0)`,
    `    this.#cache.set(key, computed)`,
    `    return computed`,
    '  }',
    '}',
    '',
  ]
  return { lines: lines.length, text: lines.join('\n') + '\n' }
}

// Screen-width-plus lines with dense token counts: chained calls, template
// literals, ternaries split across nothing. These are the painful lines.
function chainedExpressionBlock(random: () => number, index: number) {
  const chain =
    `export const resolvedPipeline_${index} = createPipeline({ name: 'pipeline_${index}', stages: ${Math.floor(random() * 12) + 2} })` +
    `.withTransform((input: number[]) => input.map((value) => value * ${pick(random, [2, 3, 5])}).filter((value) => value > ${Math.floor(random() * 50)}))` +
    `.withValidation((result) => result.every((value) => Number.isFinite(value) && value < ${Math.floor(random() * 100000) + 1000}))` +
    `.withFallback(() => [${Array.from({ length: 6 }, () => Math.floor(random() * 100)).join(', ')}])` +
    `.build()`
  const lines = [chain, '']
  return { lines: lines.length, text: lines.join('\n') + '\n' }
}

function commentBlock(index: number, available: number) {
  const count = Math.min(3, Math.max(1, available))
  const lines = Array.from(
    { length: count },
    (_, i) => `// segment ${index} note ${i}: dense token stress fixture for editor benchmarks`,
  )
  return { lines: count, text: lines.join('\n') + '\n' }
}

function pick<T>(random: () => number, values: readonly T[]) {
  return values[Math.floor(random() * values.length)]
}
