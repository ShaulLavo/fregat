import { createHash } from 'node:crypto'

// Only receipt readers and output predicates are validation-only. Unknown sources belong to
// measurement, including launch, readiness fences, worker interception and identity partitioning.
const validationSources = new Set(['input-output.mjs', 'src/input-output.ts'])

export function inputSourceIdentity(sources, externalHash, launch = {}) {
  const measurement = createHash('sha256').update(externalHash).update(JSON.stringify(launch))
  const validation = createHash('sha256').update(externalHash)
  const measurementFiles = []
  const validationFiles = []
  for (const { path, bytes } of [...sources].sort((left, right) =>
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
