import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const PHOSPHOR_WEIGHTS = ['thin', 'light', 'regular', 'bold', 'fill', 'duotone'] as const

export type PhosphorWeight = (typeof PHOSPHOR_WEIGHTS)[number]

// `IconBase` falls back to `regular` when no `weight` prop is set, so it is kept
// whether or not a call site names it.
const DEFAULT_WEIGHT: PhosphorWeight = 'regular'

const DEF_MODULE = /@phosphor-icons\/react\/dist\/defs\/[^/]+\.es\.js$/
const SOURCE_FILE = /\.tsx?$/
const WEIGHT_PROP = /(?<![\w$-])weight=/g
const ICON_CONTEXT = /(?<![\w$])IconContext(?![\w$])/g

/**
 * Drops the icon weights nothing draws from `@phosphor-icons/react`. A pruned
 * weight renders an empty `<svg>` rather than failing, so the kept set is read
 * out of source on every build instead of being written down.
 */
export function phosphorWeightPlugin(sourceRoots: readonly string[]): Plugin {
  let kept: ReadonlySet<PhosphorWeight> = new Set(PHOSPHOR_WEIGHTS)
  return {
    name: 'platform-phosphor-weights',
    apply: 'build',
    buildStart() {
      kept = collectKeptWeights(sourceRoots)
    },
    transform(code, id) {
      if (!DEF_MODULE.test(id.split('?')[0] ?? id)) return null
      const pruned = pruneWeights(code, kept)
      if (pruned === code) return null
      return { code: pruned, map: null }
    },
  }
}

/** Every weight drawn anywhere under `sourceRoots`, plus the implicit default. */
export function collectKeptWeights(sourceRoots: readonly string[]): ReadonlySet<PhosphorWeight> {
  const kept = new Set<PhosphorWeight>([DEFAULT_WEIGHT])
  const violations: string[] = []
  for (const root of sourceRoots) {
    for (const file of sourceFiles(root)) {
      readWeights(file, fs.readFileSync(file, 'utf8'), kept, violations)
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Phosphor weights must be readable from source before the build prunes them:\n${violations.join('\n')}`,
    )
  }
  return kept
}

function readWeights(
  file: string,
  source: string,
  kept: Set<PhosphorWeight>,
  violations: string[],
): void {
  for (const match of source.matchAll(ICON_CONTEXT)) {
    violations.push(
      `${at(file, source, match.index)} IconContext hides the weight a call site draws`,
    )
  }
  for (const match of source.matchAll(WEIGHT_PROP)) {
    const weight = literalWeight(source, match.index + match[0].length)
    if (weight === null) {
      violations.push(`${at(file, source, match.index)} weight= is not a string literal`)
      continue
    }
    if (!isWeight(weight)) {
      violations.push(`${at(file, source, match.index)} unknown weight '${weight}'`)
      continue
    }
    kept.add(weight)
  }
}

/** Reads `'bold'`, `"bold"` or `{'bold'}` at `start`; anything else is null. */
function literalWeight(source: string, start: number): string | null {
  const braced = source[start] === '{'
  const open = braced ? skipSpace(source, start + 1) : start
  const quote = source[open]
  if (quote !== "'" && quote !== '"') return null
  const close = source.indexOf(quote, open + 1)
  if (close < 0) return null
  if (braced && source[skipSpace(source, close + 1)] !== '}') return null
  return source.slice(open + 1, close)
}

function skipSpace(source: string, index: number): number {
  let i = index
  while (i < source.length && /\s/.test(source[i] ?? '')) i++
  return i
}

function isWeight(value: string): value is PhosphorWeight {
  return (PHOSPHOR_WEIGHTS as readonly string[]).includes(value)
}

function at(file: string, source: string, index: number): string {
  return `${file}:${source.slice(0, index).split('\n').length}`
}

function* sourceFiles(root: string): Generator<string> {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      yield* sourceFiles(full)
      continue
    }
    if (entry.isFile() && SOURCE_FILE.test(entry.name)) yield full
  }
}

/**
 * Rewrites a definition module's `new Map([...])` to the kept weights only.
 * The shape is asserted: a definition this cannot read is a build failure, not
 * a silently unpruned module.
 */
export function pruneWeights(code: string, kept: ReadonlySet<PhosphorWeight>): string {
  const call = code.indexOf('new Map([')
  if (call < 0) throw new Error('Phosphor definition has no `new Map([` to prune')

  const open = call + 'new Map('.length
  const { entries, close } = parseEntries(code, open)
  const survivors = entries.filter((entry) => kept.has(entry.key as PhosphorWeight))
  if (survivors.length === entries.length) return code
  return `${code.slice(0, open)}[${survivors.map((entry) => entry.text).join(',')}]${code.slice(close + 1)}`
}

type Entry = { readonly key: string; readonly text: string }

function parseEntries(code: string, open: number): { entries: Entry[]; close: number } {
  const entries: Entry[] = []
  let i = open + 1
  while (i < code.length) {
    const char = code[i]
    if (char === ']') return { entries, close: i }
    if (char === '[') {
      const end = scanBalanced(code, i)
      entries.push({ key: readKey(code, i + 1), text: code.slice(i, end + 1) })
      i = end + 1
      continue
    }
    if (char === ',' || /\s/.test(char ?? '')) {
      i++
      continue
    }
    if (char === '/') {
      i = skipComment(code, i)
      continue
    }
    throw new Error(`Unexpected ${JSON.stringify(char)} in Phosphor definition map`)
  }
  throw new Error('Unterminated Phosphor definition map')
}

function readKey(code: string, start: number): string {
  let i = start
  while (i < code.length) {
    const char = code[i]
    if (/\s/.test(char ?? '')) {
      i++
      continue
    }
    if (char === '/') {
      i = skipComment(code, i)
      continue
    }
    if (char !== '"' && char !== "'") break
    return code.slice(i + 1, skipString(code, i) - 1)
  }
  throw new Error('Phosphor definition entry does not start with a weight name')
}

function scanBalanced(code: string, start: number): number {
  let depth = 0
  let i = start
  while (i < code.length) {
    const char = code[i] ?? ''
    if (char === '"' || char === "'" || char === '`') {
      i = skipString(code, i)
      continue
    }
    if (char === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      i = skipComment(code, i)
      continue
    }
    if (char === '[' || char === '(' || char === '{') depth++
    else if (char === ']' || char === ')' || char === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  throw new Error('Unterminated Phosphor definition entry')
}

/** `index` is at the opening quote; returns the index after the closing one. */
function skipString(code: string, index: number): number {
  const quote = code[index]
  let i = index + 1
  while (i < code.length) {
    if (code[i] === '\\') {
      i += 2
      continue
    }
    if (code[i] === quote) return i + 1
    i++
  }
  throw new Error('Unterminated string in Phosphor definition')
}

function skipComment(code: string, index: number): number {
  if (code[index + 1] === '/') {
    const end = code.indexOf('\n', index)
    return end < 0 ? code.length : end + 1
  }
  if (code[index + 1] === '*') {
    const end = code.indexOf('*/', index)
    if (end < 0) throw new Error('Unterminated comment in Phosphor definition')
    return end + 2
  }
  throw new Error('Unexpected "/" in Phosphor definition')
}
