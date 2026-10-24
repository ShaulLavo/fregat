import type { ProductionMarkdownFrame } from '../../apps/web/test/factories/markdown-production-types'

const PREVIEW_UNITS = 2048
const PATH_UNITS = 1024

type Field =
  | { readonly present: false }
  | {
      readonly present: true
      readonly preview: string
      readonly truncated: boolean
    }
type Difference = {
  readonly path: string
  readonly pathTruncated: boolean
  readonly actual: Field
  readonly expected: Field
  readonly stringDifference: ReturnType<typeof stringDifference>
}

// Each preview stops consuming after 2048 UTF16 units. No full projection is serialized here.
function preview(value: unknown) {
  let text = ''
  for (const token of tokens(value)) {
    const remaining = PREVIEW_UNITS - text.length
    if (token.length > remaining)
      return { preview: text + token.slice(0, remaining), truncated: true }
    text += token
  }
  return { preview: text, truncated: false }
}

function* tokens(value: unknown): Generator<string> {
  if (typeof value === 'string') {
    yield '"'
    for (const unit of value) yield JSON.stringify(unit).slice(1, -1)
    yield '"'
    return
  }
  if (Array.isArray(value)) {
    yield* arrayTokens(value)
    return
  }
  if (value && typeof value === 'object') {
    yield* objectTokens(value)
    return
  }
  yield JSON.stringify(value) ?? 'undefined'
}

function* arrayTokens(value: readonly unknown[]): Generator<string> {
  yield '['
  for (const [index, item] of value.entries()) {
    if (index > 0) yield ','
    yield* tokens(item)
  }
  yield ']'
}

function* objectTokens(value: object): Generator<string> {
  yield '{'
  let first = true
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    if (!first) yield ','
    first = false
    yield* tokens(key)
    yield ':'
    yield* tokens(Reflect.get(value, key))
  }
  yield '}'
}

function field(value: unknown, present: boolean): Field {
  return present ? { present: true, ...preview(value) } : { present: false }
}

function difference(
  path: string,
  actual: unknown,
  expected: unknown,
  a = true,
  b = true,
): Difference {
  return {
    path: path.slice(0, PATH_UNITS),
    pathTruncated: path.length > PATH_UNITS,
    actual: field(actual, a),
    expected: field(expected, b),
    stringDifference: stringDifference(actual, expected),
  }
}

function stringDifference(actual: unknown, expected: unknown) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return null
  let offset = 0
  while (
    offset < Math.min(actual.length, expected.length) &&
    actual.charCodeAt(offset) === expected.charCodeAt(offset)
  )
    offset++
  return {
    utf16Offset: offset,
    actualCodeUnit: offset < actual.length ? actual.charCodeAt(offset) : null,
    expectedCodeUnit: offset < expected.length ? expected.charCodeAt(offset) : null,
    excerptStartUtf16: Math.max(0, offset - 16),
    actualExcerpt: actual.slice(Math.max(0, offset - 16), offset + 17),
    expectedExcerpt: expected.slice(Math.max(0, offset - 16), offset + 17),
  }
}

function firstDifference(actual: unknown, expected: unknown, path = '$'): Difference | null {
  if (Object.is(actual, expected)) return null
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object')
    return difference(path, actual, expected)
  if (Array.isArray(actual) && Array.isArray(expected))
    return arrayDifference(actual, expected, path)
  if (Array.isArray(actual) !== Array.isArray(expected)) return difference(path, actual, expected)
  return objectDifference(actual, expected, path)
}

function arrayDifference(
  actual: readonly unknown[],
  expected: readonly unknown[],
  path: string,
): Difference | null {
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    if (index >= actual.length || index >= expected.length)
      return difference(
        `${path}[${index}]`,
        actual[index],
        expected[index],
        index < actual.length,
        index < expected.length,
      )
    const found = firstDifference(actual[index], expected[index], `${path}[${index}]`)
    if (found) return found
  }
  return null
}

function objectDifference(actual: object, expected: object, path: string): Difference | null {
  for (const key in actual) {
    if (!Object.hasOwn(actual, key)) continue
    const childPath = `${path}.${key.slice(0, PATH_UNITS + 1)}`
    if (!Object.hasOwn(expected, key))
      return difference(childPath, Reflect.get(actual, key), undefined, true, false)
    const found = firstDifference(Reflect.get(actual, key), Reflect.get(expected, key), childPath)
    if (found) return found
  }
  for (const key in expected) {
    if (!Object.hasOwn(expected, key) || Object.hasOwn(actual, key)) continue
    return difference(
      `${path}.${key.slice(0, PATH_UNITS + 1)}`,
      undefined,
      Reflect.get(expected, key),
      false,
      true,
    )
  }
  return null
}

function observation(frame: ProductionMarkdownFrame) {
  return { text: frame.text, elements: frame.elements }
}

export function productionMismatchWitness(options: {
  readonly actual: ProductionMarkdownFrame
  readonly expected: ProductionMarkdownFrame
  readonly actualEngine: string
  readonly expectedEngine: string
}) {
  const actual = observation(options.actual)
  const expected = observation(options.expected)
  const first = firstDifference(actual, expected)
  const revisionMismatch = options.actual.revision !== options.actual.observedRevision
  let classification: 'observation' | 'revision' | 'observation-and-revision' = 'observation'
  if (revisionMismatch) classification = first ? 'observation-and-revision' : 'revision'
  return {
    kind: 'production-observation-mismatch',
    limits: { previewUtf16Units: PREVIEW_UNITS, pathUtf16Units: PATH_UNITS, maxJsonBytes: 65536 },
    actual: {
      engine: options.actualEngine.slice(0, 64),
      revision: options.actual.revision,
      observedRevision: options.actual.observedRevision,
      live: options.actual.live,
      inputSha256: options.actual.inputSha256,
      observation: preview(actual),
    },
    expected: {
      engine: options.expectedEngine.slice(0, 64),
      revision: options.expected.revision,
      observedRevision: options.expected.observedRevision,
      live: options.expected.live,
      inputSha256: options.expected.inputSha256,
      observation: preview(expected),
    },
    firstDifference: first,
    classification,
    verdict: 'mismatch',
  }
}
