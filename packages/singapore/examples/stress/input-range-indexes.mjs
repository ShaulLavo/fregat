import { fail } from './errors.mjs'

export function verifyRangeIndexes(result) {
  return result.samples
    .filter((sample) => sample.fixture === 'short-lines' && sample.scenario === 'paste')
    .map((sample) => verifyPasteIndex(result, sample))
}

function verifyPasteIndex(result, sample) {
  const sourceLength = result.manifest.fixtures.find(
    (fixture) => fixture.id === sample.fixture,
  ).normalizedLength
  const operations = new Map(
    sample.observation.correlations.map((item) => [item.operation.id, item]),
  )
  const indexes = sample.observation.diagnostics.filter((event) => {
    if (event.name !== 'textMeasurements.index') return false
    validateIndexRange(event.detail)
    const input = operations.get(event.operation?.id)
    return (
      input &&
      event.detail.sourceLength === sourceLength &&
      event.timestampMs <= input.completedAtMs
    )
  })
  const indexedUnits = indexes.reduce((sum, event) => sum + event.detail.length, 0)
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

function validateIndexRange(detail) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail))
    fail('Missing text index range')
  for (const field of ['length', 'sourceLength', 'start', 'end']) {
    if (!Number.isSafeInteger(detail[field]) || detail[field] < 0)
      fail(`Invalid text index range ${field}`)
  }
  if (detail.length !== detail.end - detail.start || detail.end > detail.sourceLength)
    fail('Inconsistent text index range')
}
