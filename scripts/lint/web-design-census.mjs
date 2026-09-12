import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parseSync } from 'oxc-parser'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
const DEFAULT_ROOT = path.join(REPOSITORY, 'apps/web/src')
const DEFAULT_ALLOW = path.join(REPOSITORY, 'scripts/lint/web-design-allow.json')
const LIST_CAP = 40
const BAR_HEIGHT = 'h-(--bar-height)'

/** Every measure the census reports, and the target each one has to reach. */
export const TARGETS = {
  radius: { title: 'radius steps', allowed: ['md', 'lg', 'full', 'none'], histogram: true },
  bareRadius: { title: "bare 'rounded'", limit: 0, listed: true },
  buttonRadius: { title: 'radius on <Button>', limit: 0 },
  compactVariant: { title: "'compact:' utilities", limit: 0 },
  densityVars: { title: 'density variables', histogram: true },
  barHeights: { title: 'bar heights', allowed: [BAR_HEIGHT], histogram: true },
  dividerOpacity: { title: 'border-border/N dividers', limit: 0, listed: true },
  arbitraryText: { title: 'arbitrary text sizes', limit: 0, histogram: true, listed: true },
  shadow: {
    title: 'elevation steps',
    allowed: ['shadow-md', 'shadow-xl', 'shadow-none'],
    histogram: true,
  },
  rawButtons: { title: 'raw <button> elements', allowListed: true, listed: true },
  hoverFills: { title: 'hover fills', histogram: true },
  paletteLeaks: { title: 'raw palette colours', limit: 0, listed: true },
}

const MEASURES = Object.keys(TARGETS).filter((measure) => measure !== 'bareRadius')

const RADIUS_SIDES = new Set([
  't',
  'r',
  'b',
  'l',
  's',
  'e',
  'tl',
  'tr',
  'br',
  'bl',
  'ss',
  'se',
  'ee',
  'es',
])
const SHADOW_STEPS = new Set(['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'inner'])
const PALETTE_HUES =
  'red|blue|sky|amber|emerald|green|zinc|slate|gray|neutral|stone|yellow|orange|violet|purple|pink|rose|indigo|cyan|teal|lime'
const PALETTE_CLASS = new RegExp(`^(?:bg|text|border|ring)-(?:${PALETTE_HUES})-\\d+(?:/\\d+)?$`)
const COLOR_LITERAL = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|oklch\(/gi
const DENSITY_VAR = /\((--density-[a-z-]+|--bar-height|--rail-width)\)/g
const ARBITRARY_TEXT = /^text-\[[0-9.]+(?:px|rem)\]$/
const DIVIDER_OPACITY = /^border(?:-(?:[trbl]|x|y|s|e))?-border\/\d+$/
const HEIGHT_TOKEN = /^h-(?:\d+(?:\.\d+)?|px|\[[^\]]*\]|\([^)]*\))$/
const TEST_FILE = /(?:^|\/)tests?\/|\.(?:test|browser|test-d)\.tsx$/

// A class string is any literal whose whitespace-separated words all read as utilities. The
// dash-or-colon check keeps prose such as 'Hello world' out of the census.
const CLASS_TOKEN = /^(?:[^\s:]+:)*!?-?[a-z][a-z0-9]*(?:[-./][^\s:]*)*!?$/i
const BARE_UTILITIES = new Set([
  'absolute',
  'block',
  'border',
  'container',
  'contents',
  'fixed',
  'flex',
  'grid',
  'hidden',
  'inline',
  'isolate',
  'italic',
  'relative',
  'rounded',
  'shadow',
  'sticky',
  'transition',
  'truncate',
  'underline',
  'uppercase',
])

function looksLikeClassString(value) {
  const tokens = value.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return false
  if (!tokens.every((token) => CLASS_TOKEN.test(token))) return false
  return tokens.some(
    (token) => token.includes('-') || token.includes(':') || BARE_UTILITIES.has(token),
  )
}

/** Splits a class string into `{ raw, variants, base, index }` words, keeping each word's offset. */
function classTokens(value) {
  const tokens = []
  const words = /\S+/g
  for (let word = words.exec(value); word !== null; word = words.exec(value)) {
    tokens.push({ ...splitVariants(word[0]), index: word.index })
  }
  return tokens
}

function splitVariants(word) {
  const parsed = /^((?:[^:\s]+:)*)(.*)$/.exec(word)
  const prefix = parsed[1]
  return {
    raw: word,
    variants: prefix === '' ? [] : prefix.slice(0, -1).split(':'),
    base: parsed[2].replace(/^!/, '').replace(/!$/, ''),
  }
}

/** `rounded-t-md` -> `{ side: 't', step: 'md' }`. A null step is the banned off-scale default. */
function radiusInfo(base) {
  if (base !== 'rounded' && !base.startsWith('rounded-')) return null
  const segments = base === 'rounded' ? [] : base.slice('rounded-'.length).split('-')
  const side = RADIUS_SIDES.has(segments[0]) ? segments.shift() : null
  const step = segments.join('-')
  return { side, step: step === '' ? null : step }
}

function shadowStep(base) {
  if (base === 'shadow') return 'shadow'
  if (!base.startsWith('shadow-')) return null
  const step = base.slice('shadow-'.length)
  if (SHADOW_STEPS.has(step)) return base
  // Anything else after `shadow-` is a colour, not an elevation step.
  return step.startsWith('[') || step.startsWith('(') ? base : null
}

export function isTestFile(relative) {
  return TEST_FILE.test(relative)
}

function emptyCensus() {
  const hits = {}
  for (const measure of MEASURES) hits[measure] = []
  return { files: 0, hits, parseErrors: [] }
}

function mergeCensus(censuses) {
  const merged = emptyCensus()
  for (const census of censuses) {
    merged.files += census.files
    merged.parseErrors.push(...census.parseErrors)
    for (const measure of MEASURES) merged.hits[measure].push(...census.hits[measure])
  }
  return merged
}

function histogram(hits) {
  const counts = new Map()
  for (const hit of hits) counts.set(hit.value, (counts.get(hit.value) ?? 0) + 1)
  return counts
}

export function censusSource(file, source) {
  const census = emptyCensus()
  census.files = 1
  const parsed = parseSync(file, source)
  for (const error of parsed.errors) census.parseErrors.push(`${file}: ${error.message}`)
  const lineAt = lineLocator(source)
  const { strings, elements } = scan(parsed.program)
  for (const element of elements) recordElement(census, file, element, lineAt)
  const groups = new Map()
  for (const entry of strings) recordString(census, file, entry, lineAt, groups)
  recordBarHeights(census, groups)
  return census
}

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(filename)
    return entry.name.endsWith('.tsx') ? [filename] : []
  })
}

function censusTree(root) {
  const files = sourceFiles(root).filter((file) => !isTestFile(posix(path.relative(root, file))))
  return mergeCensus(
    files.map((file) => censusSource(posix(path.relative(REPOSITORY, file)), read(file))),
  )
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function posix(value) {
  return value.replaceAll('\\', '/')
}

const SKIPPED_KEYS = new Set(['type', 'start', 'end', 'range', 'loc', 'parent'])

function walk(node, visit, ancestors) {
  if (Array.isArray(node)) return walkAll(node, visit, ancestors)
  if (!node || typeof node.type !== 'string') return
  visit(node, ancestors)
  ancestors.push(node)
  for (const key of Object.keys(node)) {
    if (!SKIPPED_KEYS.has(key)) walk(node[key], visit, ancestors)
  }
  ancestors.pop()
}

function walkAll(nodes, visit, ancestors) {
  for (const node of nodes) walk(node, visit, ancestors)
}

function scan(program) {
  const strings = []
  const elements = []
  walk(program, (node, ancestors) => collect(node, ancestors, strings, elements), [])
  return { strings, elements }
}

function collect(node, ancestors, strings, elements) {
  if (node.type === 'JSXOpeningElement')
    elements.push({ name: jsxName(node.name), start: node.start })
  const value = stringValue(node)
  if (value === null) return
  const element = nearestElement(ancestors)
  strings.push({
    value,
    start: node.start,
    elementName: element === null ? null : jsxName(element.name),
    elementKey: element === null ? null : `e${element.start}`,
  })
}

function stringValue(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateElement') return node.value.cooked ?? node.value.raw
  return null
}

function jsxName(name) {
  return name?.type === 'JSXIdentifier' ? name.name : null
}

function nearestElement(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    if (ancestors[index].type === 'JSXOpeningElement') return ancestors[index]
  }
  return null
}

function lineLocator(source) {
  const lines = new Int32Array(source.length + 1)
  let line = 1
  for (let index = 0; index < source.length; index += 1) {
    lines[index] = line
    if (source[index] === '\n') line += 1
  }
  lines[source.length] = line
  return (offset) => lines[Math.min(Math.max(offset, 0), source.length)]
}

function newlinesBefore(value, index) {
  let count = 0
  for (let at = value.indexOf('\n'); at >= 0 && at < index; at = value.indexOf('\n', at + 1))
    count += 1
  return count
}

function recordElement(census, file, element, lineAt) {
  if (element.name !== 'button') return
  census.hits.rawButtons.push({ file, line: lineAt(element.start), value: '<button>' })
}

function recordString(census, file, entry, lineAt, groups) {
  const lineOf = (index) => lineAt(entry.start) + newlinesBefore(entry.value, index)
  recordColorLiterals(census, file, entry, lineOf)
  if (!looksLikeClassString(entry.value)) return
  recordDensityVars(census, file, entry, lineOf)
  const group = groupFor(groups, entry)
  for (const token of classTokens(entry.value))
    recordToken(census, file, entry, token, lineOf, group)
}

function recordColorLiterals(census, file, entry, lineOf) {
  for (const match of entry.value.matchAll(COLOR_LITERAL)) {
    census.hits.paletteLeaks.push({ file, line: lineOf(match.index), value: match[0] })
  }
}

function recordDensityVars(census, file, entry, lineOf) {
  for (const match of entry.value.matchAll(DENSITY_VAR)) {
    census.hits.densityVars.push({ file, line: lineOf(match.index), value: match[0] })
  }
}

function groupFor(groups, entry) {
  const key = entry.elementKey ?? `s${entry.start}`
  const existing = groups.get(key)
  if (existing) return existing
  const created = { bases: new Set(), heights: [] }
  groups.set(key, created)
  return created
}

function recordToken(census, file, entry, token, lineOf, group) {
  const hit = { file, line: lineOf(token.index), value: token.base }
  group.bases.add(token.base)
  if (HEIGHT_TOKEN.test(token.base)) group.heights.push(hit)
  if (token.variants.includes('compact'))
    census.hits.compactVariant.push({ ...hit, value: token.raw })
  if (DIVIDER_OPACITY.test(token.base)) census.hits.dividerOpacity.push(hit)
  if (ARBITRARY_TEXT.test(token.base)) census.hits.arbitraryText.push(hit)
  if (PALETTE_CLASS.test(token.base)) census.hits.paletteLeaks.push(hit)
  if (token.variants.includes('hover') && token.base.startsWith('bg-'))
    census.hits.hoverFills.push({ ...hit, value: `hover:${token.base}` })
  recordShadow(census, token, hit)
  recordRadius(census, entry, token, hit)
}

function recordShadow(census, token, hit) {
  const step = shadowStep(token.base)
  if (step === null) return
  census.hits.shadow.push({ ...hit, value: step })
}

function recordRadius(census, entry, token, hit) {
  if (radiusInfo(token.base) === null) return
  census.hits.radius.push(hit)
  if (entry.elementName === 'Button') census.hits.buttonRadius.push(hit)
}

// A bar is an element that carries a top or bottom rule and centres its children. Every explicit
// `h-(--bar-height)` counts wherever it sits, so the token shows up as the single settled value.
function recordBarHeights(census, groups) {
  const seen = new Set()
  for (const group of groups.values()) {
    const bar =
      (group.bases.has('border-b') || group.bases.has('border-t')) &&
      group.bases.has('items-center')
    for (const hit of group.heights) {
      if (!bar && hit.value !== BAR_HEIGHT) continue
      if (seen.has(`${hit.file}:${hit.line}:${hit.value}`)) continue
      seen.add(`${hit.file}:${hit.line}:${hit.value}`)
      census.hits.barHeights.push(hit)
    }
  }
}

function readAllowList(file) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(read(file))
}

function validateAllowEntries(value) {
  if (!Array.isArray(value))
    return ['the allow-list must be a JSON array of { file, class, reason } entries']
  return value.flatMap(entryProblems)
}

function entryProblems(entry, index) {
  const label = `allow[${index}]`
  if (!entry || typeof entry !== 'object') return [`${label}: entry must be an object`]
  const problems = []
  if (typeof entry.file !== 'string' || entry.file === '') problems.push(`${label}: missing "file"`)
  if (typeof entry.class !== 'string' || entry.class === '')
    problems.push(`${label}: missing "class"`)
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '')
    problems.push(
      `${label} (${entry.file ?? '?'} ${entry.class ?? '?'}): an exception without a reason is itself a violation`,
    )
  return problems
}

function allowKey(file, className) {
  return `${file} :: ${className}`
}

function allowIndex(entries) {
  const index = new Set()
  if (!Array.isArray(entries)) return index
  for (const entry of entries) {
    if (entryProblems(entry, 0).length > 0) continue
    index.add(allowKey(entry.file, entry.class))
  }
  return index
}

function unallowed(hits, allow) {
  return hits.filter((hit) => !allow.has(allowKey(hit.file, hit.value)))
}

function bareRadiusHits(census) {
  return census.hits.radius.filter((hit) => radiusInfo(hit.value).step === null)
}

function offScaleRadius(census) {
  return census.hits.radius.filter((hit) => {
    const step = radiusInfo(hit.value).step
    return step !== null && !TARGETS.radius.allowed.includes(step)
  })
}

function offTarget(hits, allowed) {
  return hits.filter((hit) => !allowed.includes(hit.value))
}

export function evaluate(census, allowEntries = []) {
  const allowProblems = validateAllowEntries(allowEntries)
  const allow = allowIndex(allowEntries)
  const offenders = {
    radius: unallowed(offScaleRadius(census), allow),
    bareRadius: unallowed(bareRadiusHits(census), allow),
    buttonRadius: unallowed(census.hits.buttonRadius, allow),
    compactVariant: unallowed(census.hits.compactVariant, allow),
    barHeights: unallowed(offTarget(census.hits.barHeights, TARGETS.barHeights.allowed), allow),
    dividerOpacity: unallowed(census.hits.dividerOpacity, allow),
    arbitraryText: unallowed(census.hits.arbitraryText, allow),
    shadow: unallowed(offTarget(census.hits.shadow, TARGETS.shadow.allowed), allow),
    rawButtons: unallowed(census.hits.rawButtons, allow),
    paletteLeaks: unallowed(census.hits.paletteLeaks, allow),
  }
  const failures = Object.entries(offenders)
    .filter(([, hits]) => hits.length > 0)
    .map(([measure, hits]) => ({ measure, title: TARGETS[measure].title, count: hits.length }))
  return {
    offenders,
    failures,
    allowProblems,
    passed: failures.length === 0 && allowProblems.length === 0,
  }
}

function toJson(census, result, root) {
  const measures = {}
  for (const measure of MEASURES)
    measures[measure] = Object.fromEntries(histogram(census.hits[measure]))
  return {
    root,
    files: census.files,
    measures,
    totals: Object.fromEntries(MEASURES.map((measure) => [measure, census.hits[measure].length])),
    violations: Object.fromEntries(
      Object.entries(result.offenders).map(([measure, hits]) => [measure, hits]),
    ),
    failures: result.failures,
    allowProblems: result.allowProblems,
    parseErrors: census.parseErrors,
    passed: result.passed,
  }
}

function formatHistogram(title, hits) {
  const rows = [...histogram(hits)].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )
  if (rows.length === 0) return `${title}\n  (none)`
  const width = Math.max(...rows.map(([value]) => value.length), 'total'.length)
  const body = rows.map(
    ([value, count]) => `  ${value.padEnd(width)}  ${String(count).padStart(6)}`,
  )
  return `${title}\n${body.join('\n')}\n  ${'total'.padEnd(width)}  ${String(hits.length).padStart(6)}`
}

function formatCounts(census) {
  const rows = MEASURES.concat('bareRadius').map((measure) => [
    TARGETS[measure].title,
    measure === 'bareRadius' ? bareRadiusHits(census).length : census.hits[measure].length,
  ])
  const width = Math.max(...rows.map(([title]) => title.length))
  return [
    'totals',
    ...rows.map(([title, count]) => `  ${title.padEnd(width)}  ${String(count).padStart(6)}`),
  ].join('\n')
}

function formatList(title, hits) {
  if (hits.length === 0) return `${title}: none`
  const shown = hits.slice(0, LIST_CAP).map((hit) => `  ${hit.file}:${hit.line}  ${hit.value}`)
  if (hits.length > LIST_CAP) shown.push(`  … and ${hits.length - LIST_CAP} more`)
  return `${title}: ${hits.length}\n${shown.join('\n')}`
}

function formatGate(result) {
  const lines = result.allowProblems.map((problem) => `  allow-list  ${problem}`)
  for (const failure of result.failures)
    lines.push(`  ${failure.title}: ${failure.count} over target`)
  if (lines.length === 0) return 'gate: every measure is on target'
  return `gate: ${lines.length} measure(s) off target\n${lines.join('\n')}`
}

function formatReport(census, result, root) {
  const listed = MEASURES.concat('bareRadius').filter((measure) => TARGETS[measure].listed)
  return [
    `Web design census — ${census.files} .tsx files under ${root} (tests excluded)`,
    '',
    formatCounts(census),
    '',
    ...MEASURES.filter((measure) => TARGETS[measure].histogram).map(
      (measure) => `${formatHistogram(TARGETS[measure].title, census.hits[measure])}\n`,
    ),
    ...listed.map((measure) => `${formatList(TARGETS[measure].title, hitsFor(census, measure))}\n`),
    formatGate(result),
    '',
  ].join('\n')
}

function hitsFor(census, measure) {
  return measure === 'bareRadius' ? bareRadiusHits(census) : census.hits[measure]
}

function main() {
  const { values } = parseArgs({
    options: {
      allow: { type: 'string', default: DEFAULT_ALLOW },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      root: { type: 'string', default: DEFAULT_ROOT },
    },
  })
  const root = path.resolve(values.root)
  const census = censusTree(root)
  const allowEntries = readAllowList(path.resolve(values.allow))
  const result = evaluate(census, allowEntries)
  const relativeRoot = posix(path.relative(REPOSITORY, root)) || root
  const output = values.json
    ? `${JSON.stringify(toJson(census, result, relativeRoot), null, 2)}\n`
    : formatReport(census, result, relativeRoot)
  process.stdout.write(output)
  process.exitCode = values.check && !result.passed ? 1 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
