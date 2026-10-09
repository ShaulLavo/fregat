import { DocumentEditChain } from '../src/editor/editChain'

const samples = 7
const iterations = 25_600
let checksum = 0

function measure(historyLength: number): number {
  const chain = new DocumentEditChain()
  let base = chain.point
  const started = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    const offset = index % historyLength
    if (offset === 0) {
      chain.rotate()
      base = chain.point
    }
    const point = chain.point
    chain.record({
      edits: [{ from: offset, to: offset, text: 'x' }],
      logicalRevisionCount: 1,
      logicalRevisionScope: null,
      revisionBefore: point.revision,
      revisionAfter: point.revision + 1,
      textChanged: true,
    })
    checksum += chain.changesSince(base, null)!.edits![0]!.text.length
  }
  return ((performance.now() - started) * 1_000) / iterations
}

for (const historyLength of [1, 128]) {
  measure(historyLength)
  measure(historyLength)
  const microseconds = Array.from({ length: samples }, () => measure(historyLength)).sort(
    (left, right) => left - right,
  )
  console.log(
    JSON.stringify({
      historyLength,
      iterations,
      samples,
      medianMicrosecondsPerEdit: microseconds[Math.floor(samples / 2)],
      minMicrosecondsPerEdit: microseconds[0],
      maxMicrosecondsPerEdit: microseconds.at(-1),
    }),
  )
}
console.log(JSON.stringify({ checksum }))
