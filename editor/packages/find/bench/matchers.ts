import { generateFixture } from '../../../examples/stress/src/fixtures'

// The literal matchers a windowed scan could run over one window's text. Native
// `indexOf` is the control; the others are here to be beaten by it or not.
const text = generateFixture('short-lines')
const NEEDLES = ['needle', 'zzqqzz', 'const', '= 42', 'a']

function nativeIndexOf(haystack: string, needle: string): number {
  let count = 0
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  )
    count += 1
  return count
}

function horspool(haystack: string, needle: string): number {
  const last = needle.length - 1
  const shift = new Uint32Array(65_536).fill(needle.length)
  for (let index = 0; index < last; index += 1) shift[needle.charCodeAt(index)] = last - index

  let count = 0
  let at = 0
  while (at + last < haystack.length) {
    let back = last
    while (back >= 0 && haystack.charCodeAt(at + back) === needle.charCodeAt(back)) back -= 1
    if (back < 0) {
      count += 1
      at += needle.length
      continue
    }
    at += shift[haystack.charCodeAt(at + last)] ?? 1
  }
  return count
}

function regexExec(haystack: string, needle: string): number {
  const matcher = new RegExp(needle.replace(/[\\{}*+?|^$.[\]()]/g, '\\$&'), 'gu')
  let count = 0
  while (matcher.exec(haystack)) count += 1
  return count
}

function median(run: () => number): { ms: number; count: number } {
  let count = run()
  const samples: number[] = []
  for (let index = 0; index < 9; index += 1) {
    const start = performance.now()
    count = run()
    samples.push(performance.now() - start)
  }
  samples.sort((left, right) => left - right)
  return { ms: Number((samples[4] ?? 0).toFixed(3)), count }
}

const rows = NEEDLES.map((needle) => {
  const native = median(() => nativeIndexOf(text, needle))
  const bmh = median(() => horspool(text, needle))
  const regex = median(() => regexExec(text, needle))
  if (native.count !== bmh.count || native.count !== regex.count)
    throw new Error(`count mismatch for ${needle}`)
  return {
    needle,
    matches: native.count,
    indexOfMs: native.ms,
    horspoolMs: bmh.ms,
    regexMs: regex.ms,
  }
})
console.table(rows)
