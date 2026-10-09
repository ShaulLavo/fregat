import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import allowlist from './session-vocabulary-allowlist.json'

const repositoryRoot = path.resolve(import.meta.dirname, '../../../..')
const ownedRoots = [
  'packages/contracts/src',
  'apps/server/src/orchestration',
  'apps/server/src/provider',
  'apps/web/src/features/chat',
  'apps/web/src/features/chat-mode',
  'apps/web/src/features/address',
]
const noun = ['th', 'read'].join('')
const capitalNoun = ['Th', 'read'].join('')
const idName = `${capitalNoun}Id`
const recordName = `Orchestration${capitalNoun}`
const vocabulary = new RegExp(
  String.raw`\b(?:${noun}[./][\w$./-]+|[\w$]*(?:${capitalNoun}|${noun})[\w$]*)\b`,
  'g',
)

test.each([
  `${noun}Ids`,
  `${noun}IdSchema`,
  `orchestration${['Th', 'read'].join('')}Schema`,
  `projection${['Th', 'reads'].join('')}`,
  `${noun}/start`,
  `${idName}Schema`,
  `${recordName}Shell`,
  `${noun}.turn.start`,
])('detects forbidden session-domain vocabulary: %s', (symbol) => {
  expect(Array.from(symbol.matchAll(vocabulary), ([match]) => match)).toEqual([symbol])
})

test('retains only exact upstream protocol vocabulary across the session domain', () => {
  const actual: Record<string, Record<string, number>> = {}
  for (const file of ownedRoots.flatMap(sourceFiles).sort()) {
    const symbols = symbolsInSource(readFileSync(path.join(repositoryRoot, file), 'utf8'))
    if (Object.keys(symbols).length === 0) continue
    actual[file] = symbols
  }
  expect(actual).toEqual(allowlist)
})

test('ignores prose comments while retaining quoted wire verbs and identifiers', () => {
  const source = [
    `// ${idName} is an upstream term`,
    `/* ${noun}/start */`,
    `const ${noun}Ids = '${noun}/start'`,
    `const url = 'https://example.test/${noun}/read'`,
    `const message = \`${noun}/resume\``,
  ].join('\n')
  expect(symbolsInSource(source)).toEqual({
    [`${noun}Ids`]: 1,
    [`${noun}/start`]: 1,
    [`${noun}/read`]: 1,
    [`${noun}/resume`]: 1,
  })
})

function sourceFiles(relative: string): string[] {
  return readdirSync(path.join(repositoryRoot, relative), { withFileTypes: true }).flatMap(
    (entry) => {
      const file = `${relative}/${entry.name}`
      if (entry.isDirectory()) return sourceFiles(file)
      return /\.tsx?$/.test(entry.name) ? [file] : []
    },
  )
}

function symbolsInSource(source: string) {
  const counts = new Map<string, number>()
  const code = source.replace(
    /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith('/') ? '' : token),
  )
  for (const [symbol] of code.matchAll(vocabulary))
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1)
  return Object.fromEntries(Array.from(counts).sort(([left], [right]) => left.localeCompare(right)))
}
