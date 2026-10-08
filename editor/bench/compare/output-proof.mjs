// Run after the settled frame so hashing does not enter the open clock.
export async function outputProof() {
  const probe = globalThis.__compareOpenProbe
  const result = probe.outputs.at(-1)
  if (!result && probe.proof) return probe.proof
  if (!result?.tokensPacked) throw new RangeError('Missing packed full output')
  const { starts, ends, styleIds, styles } = result.tokensPacked
  const end = result.statistics.rangeEnd
  if (
    !starts.length ||
    starts.length !== ends.length ||
    starts.length !== styleIds.length ||
    !styles.length ||
    !Number.isSafeInteger(end)
  )
    throw new RangeError('Invalid packed token array lengths or source bounds')
  const stable = (value) => {
    if (ArrayBuffer.isView(value)) return [...value]
    if (Array.isArray(value)) return value.map(stable)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, stable(value[key])]),
      )
    return value
  }
  const palette = styles.map((style) => JSON.stringify(stable(style)))
  const canonical = [...new Set(palette)].sort()
  const ids = palette.map((style) => canonical.indexOf(style))
  const bytes = new ArrayBuffer(starts.length * 12)
  const view = new DataView(bytes)
  for (let i = 0; i < starts.length; i++) {
    if (
      starts[i] >= ends[i] ||
      ends[i] > end ||
      styleIds[i] >= styles.length ||
      (i && starts[i] < starts[i - 1])
    )
      throw new RangeError('Invalid complete token stream')
    view.setUint32(i * 12, starts[i], true)
    view.setUint32(i * 12 + 4, ends[i], true)
    view.setUint32(i * 12 + 8, ids[styleIds[i]], true)
  }
  const hash = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
  const proof = {
    tokenCount: starts.length,
    injectionCount: result.injections.length,
    errorCount: result.errors.length,
    tokenSha256: await hash(bytes),
    stylesSha256: await hash(encode(canonical)),
    structuralSha256: await hash(
      encode(
        stable({
          records: result.records,
          folds: result.folds,
          brackets: result.brackets,
          errors: result.errors,
          injections: result.injections,
        }),
      ),
    ),
    firstToken: [starts[0], ends[0], ids[styleIds[0]]],
    lastToken: [starts.at(-1), ends.at(-1), ids[styleIds.at(-1)]],
    missingLanguages: result.missingLanguages ?? [],
    coverage: result.statistics.__compareCoverage,
    wasmBytes: result.statistics.__compareWasmBytes,
    queryCalls: result.statistics.__compareQueryCalls,
    matchLimitExceeded: result.statistics.__compareMatchLimitExceeded,
  }
  if (probe.outputs.at(-1) === result) {
    probe.proof = proof
    probe.outputs.length = 0
  }
  return proof
}

export function verifyOutputEquality(rows) {
  const expected = new Map()
  for (const row of rows.filter((row) => row.editor === 'singapore')) {
    if (row.status !== 'ok') throw new RangeError('Qualification contains failed Singapore samples')
    const key = `${row.corpus ?? 'repeated'}-${row.mib}`
    const output = row.outputProof
    if (!output) throw new RangeError('Qualification requires output proof')
    const identity = JSON.stringify([
      output.tokenCount,
      output.tokenSha256,
      output.stylesSha256,
      output.structuralSha256,
      output.coverage,
    ])
    if (expected.has(key) && expected.get(key) !== identity)
      throw new RangeError(`Unequal full output for ${key}`)
    expected.set(key, identity)
  }
  if (!expected.size) throw new RangeError('Qualification has no Singapore samples')
}
