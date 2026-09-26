// Reproduces the engine rows of docs/editing/spellcheck-research.md.
//   bun bench/engine.ts [plans-dir] [norvig-testsets-dir]
// Corpus: the first 10,000 lines of the plans' Markdown. Quality: Norvig's spell-testset1/2, fetched
// from norvig.com when the directory does not hold them.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createSpellEngine, type SpellEngine } from '../src/engine'
import { tokenizeSpellWords, type SpellTextRange } from '../src/tokenizer'
import { bundledEngineSource } from '../test/dictionaries'

const plansDir = process.argv[2] ?? '/work/projects/platform/plans'
const testsetDir = process.argv[3] ?? '/work/tmp/research2/spellcheck/data'
const CORPUS_LINES = 10_000
const VIEWPORT_LINES = 60
const SUGGESTIONS = 5

const corpus = readCorpus(plansDir)
const source = bundledEngineSource()

const initStart = performance.now()
const engine = createSpellEngine(source)
const initMs = performance.now() - initStart

const tokenizeStart = performance.now()
const words = proseWords(corpus)
const tokenizeMs = performance.now() - tokenizeStart
const viewport = corpus
  .split('\n')
  .slice(4000, 4000 + VIEWPORT_LINES)
  .join('\n')
const viewportMs = timeRepeated(100, () => proseWords(viewport))

const checkStart = performance.now()
for (const word of words) engine.isCorrect(word)
const checkAllMs = performance.now() - checkStart

const distinct = new Set(words)
const flagged = engine.check([...distinct])
const quality = await suggestionQuality(engine)

console.log(
  JSON.stringify(
    {
      corpusLines: CORPUS_LINES,
      words: words.length,
      distinctWords: distinct.size,
      initMs: round(initMs),
      tokenizeCorpusMs: round(tokenizeMs),
      tokenizeViewportMs: round(viewportMs, 3),
      checkAllMs: round(checkAllMs),
      flaggedDistinct: flagged.length,
      flaggedOccurrences: words.filter((word) => flagged.includes(word)).length,
      ...quality,
    },
    null,
    2,
  ),
)

function readCorpus(directory: string): string {
  const files = readdirSync(directory)
    .filter((name) => name.endsWith('.md'))
    .toSorted()
  const text = files.map((name) => readFileSync(path.join(directory, name), 'utf8')).join('\n')
  return text.split('\n').slice(0, CORPUS_LINES).join('\n')
}

/** Markdown code and link targets are what the view will exclude through syntax. */
function proseWords(text: string): readonly string[] {
  const excluded: SpellTextRange[] = []
  for (const pattern of [/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, /`[^`\n]*`/g, /\]\([^)\n]*\)/g]) {
    for (const match of text.matchAll(pattern)) {
      excluded.push({ start: match.index, end: match.index + match[0].length })
    }
  }
  return tokenizeSpellWords(text, { excluded }).map((word) => word.word)
}

async function suggestionQuality(spell: SpellEngine) {
  const pairs = (await typoPairs()).filter(
    ([target, wrong]) => spell.isCorrect(target) && !spell.isCorrect(wrong),
  )
  const times: number[] = []
  let top1 = 0
  let top5 = 0
  for (const [target, wrong] of pairs) {
    const start = performance.now()
    const suggestions = spell.suggest(wrong, SUGGESTIONS)
    times.push(performance.now() - start)
    if (suggestions[0] === target) top1++
    if (suggestions.includes(target)) top5++
  }
  return {
    typoPairs: pairs.length,
    suggestMedianMs: round(percentile(times, 0.5), 2),
    suggestP95Ms: round(percentile(times, 0.95), 2),
    suggestMaxMs: round(Math.max(...times), 1),
    top1: round((100 * top1) / pairs.length),
    top5: round((100 * top5) / pairs.length),
  }
}

async function typoPairs(): Promise<readonly (readonly [string, string])[]> {
  const pairs: [string, string][] = []
  for (const name of ['spell-testset1.txt', 'spell-testset2.txt']) {
    for (const line of (await testset(name)).split('\n')) {
      const [target, rest] = line.split(':')
      if (!target || !rest) continue
      for (const wrong of rest.trim().split(/\s+/)) pairs.push([target.trim(), wrong])
    }
  }
  return pairs
}

async function testset(name: string): Promise<string> {
  const local = path.join(testsetDir, name)
  if (existsSync(local)) return readFileSync(local, 'utf8')
  const response = await fetch(`https://norvig.com/${name}`)
  return response.text()
}

function timeRepeated(times: number, run: () => void): number {
  const start = performance.now()
  for (let index = 0; index < times; index++) run()
  return (performance.now() - start) / times
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits))
}
