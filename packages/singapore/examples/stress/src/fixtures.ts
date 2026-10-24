export const generatorVersion = 1
export const defaultSeed = 60061
export const fixtureIds = [
  'ordinary',
  'short-lines',
  'long-line',
  'unicode',
  'mixed-endings',
] as const
export type FixtureId = (typeof fixtureIds)[number]

export function generateFixture(id: FixtureId, seed = defaultSeed): string {
  const random = seededRandom(seed)
  if (id === 'long-line') return `const needle = "${'a'.repeat(1_048_576)}";`
  if (id === 'unicode') return unicodeText(random)
  if (id === 'mixed-endings') return mixedText(random)
  const count = id === 'short-lines' ? 500_000 : 200
  return Array.from({ length: count }, (_, row) => codeLine(row, random())).join('\n')
}

export function normalizedText(text: string): string {
  return text.replace(/\r\n?|\u2028|\u2029/g, '\n')
}

export function fixtureFacts(text: string) {
  const normalized = normalizedText(text)
  const lines = normalized.split('\n')
  return {
    bytes: new TextEncoder().encode(text).length,
    utf16Length: text.length,
    normalizedLength: normalized.length,
    lines: lines.length,
    longestLine: longestLine(lines),
    searchCount: normalized.split('needle').length - 1,
  }
}

function longestLine(lines: readonly string[]): number {
  let longest = 0
  for (const line of lines) longest = Math.max(longest, line.length)
  return longest
}

function codeLine(row: number, value: number): string {
  const name = row % 997 === 0 ? 'needle' : 'value'
  return `const ${name}${row} = ${value % 10000};`
}

function unicodeText(random: () => number): string {
  const boundary = `//${'x'.repeat(4093)}😀e\u0301\n`
  const lines = Array.from(
    { length: 2048 },
    (_, row) => `const value${row} = "😀 e\u0301 👩🏽‍💻 日本語 ${random() % 100} needle";`,
  )
  return boundary + lines.join('\n')
}

function mixedText(random: () => number): string {
  const endings = ['\r\n', '\n', '\r']
  return Array.from({ length: 3000 }, (_, row) => codeLine(row, random()) + endings[row % 3]).join(
    '',
  )
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
}
