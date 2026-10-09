import { createHash } from 'node:crypto'

// Postcapture predicates are validation-only. The frontend reader records attestation used by
// live readiness, so its bytes and unknown sources belong to measurement.
const validationSources = new Set(['input-output.mjs'])

export function inputSourceIdentity(sources, externalHash, launch = {}) {
  const measurement = createHash('sha256').update(externalHash).update(JSON.stringify(launch))
  const validation = createHash('sha256').update(externalHash)
  const measurementFiles = []
  const validationFiles = []
  for (const { path, bytes } of sources.toSorted((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const validationOnly = validationSources.has(path.replace(/^examples\/stress\//, ''))
    const hash = validationOnly ? validation : measurement
    hash.update(path).update('\0').update(bytes).update('\0')
    ;(validationOnly ? validationFiles : measurementFiles).push(path)
  }
  const measurementHash = measurement.digest('hex')
  const validationHash = validation.digest('hex')
  return {
    hash: createHash('sha256').update(measurementHash).update(validationHash).digest('hex'),
    measurementHash,
    validationHash,
    measurementFiles,
    validationFiles,
  }
}
