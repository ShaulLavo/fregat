import { fail } from './errors.ts'

interface IndexDetail {
  length: number
  sourceLength: number
  start: number
  end: number
}
interface IndexDiagnostic {
  name: string
  timestampMs: number
  operation?: { id: number }
  detail?: unknown
}
interface IndexSample {
  fixture: string
  scenario: string
  views: string
  repetition: number
  observation: {
    correlations: { operation: { id: number }; completedAtMs: number }[] | null
    diagnostics: IndexDiagnostic[]
  }
}
interface IndexResult {
  manifest: { fixtures: { id: string; normalizedLength: number }[] }
  samples: IndexSample[]
}

export function verifyRangeIndexes(result: IndexResult) {
  return result.samples
    .filter((sample) => sample.fixture === 'short-lines' && sample.scenario === 'paste')
    .map((sample) => verifyPasteIndex(result, sample))
}

function verifyPasteIndex(result: IndexResult, sample: IndexSample) {
  const sourceLength = result.manifest.fixtures.find(
    (fixture) => fixture.id === sample.fixture,
  )?.normalizedLength
  if (sourceLength === undefined) fail('Missing paste fixture')
  if (!sample.observation.correlations) fail('Missing paste diagnostic correlations')
  const operations = new Map(
    sample.observation.correlations.map((item) => [item.operation.id, item]),
  )
  const indexes = sample.observation.diagnostics.filter((event) => {
    if (event.name !== 'textMeasurements.index') return false
    validateIndexRange(event.detail)
    const input = event.operation ? operations.get(event.operation.id) : undefined
    return (
      input &&
      event.detail.sourceLength === sourceLength &&
      event.timestampMs <= input.completedAtMs
    )
  })
  const indexedUnits = indexes.reduce((sum, event) => {
    validateIndexRange(event.detail)
    return sum + event.detail.length
  }, 0)
  if (!Number.isSafeInteger(indexedUnits) || indexedUnits <= 0 || indexedUnits > 512)
    fail('Paste indexed more than the bounded original source leaves, or evidence is missing')
  return {
    fixture: sample.fixture,
    views: sample.views,
    repetition: sample.repetition,
    sourceLength,
    indexedUnits,
  }
}

function validateIndexRange(detail: unknown): asserts detail is IndexDetail {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail))
    fail('Missing text index range')
  if (
    !(
      'length' in detail &&
      typeof detail.length === 'number' &&
      'sourceLength' in detail &&
      typeof detail.sourceLength === 'number' &&
      'start' in detail &&
      typeof detail.start === 'number' &&
      'end' in detail &&
      typeof detail.end === 'number'
    )
  )
    fail('Invalid text index range')
  for (const value of [detail.length, detail.sourceLength, detail.start, detail.end]) {
    if (!Number.isSafeInteger(value) || value < 0) fail('Invalid text index range')
  }
  if (detail.length !== detail.end - detail.start || detail.end > detail.sourceLength)
    fail('Inconsistent text index range')
}
