import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parseSync } from 'oxc-parser'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
// The app and the primitives it composes are one design surface; measuring only the app leaves
// every class the primitives encode unmeasured.
const DEFAULT_ROOTS = ['apps/web/src', 'packages/markdown/src', 'packages/ui/src'].map((root) =>
  path.join(REPOSITORY, root),
)
const UI_PACKAGE = 'packages/ui/src/'
const DEFAULT_ALLOW = path.join(REPOSITORY, 'scripts/lint/web-design-allow.json')
const LIST_CAP = 40
const BAR_HEIGHT = 'h-(--bar-height)'

/**
 * Every measure the census reports, and the target each one has to reach.
 *
 * `limit` and `allowed` gate: a hit outside them fails `--check` unless the allow-list excuses it.
 * `histogramOnly` reports instead of failing; where it is paired with `gates`, the one slice named
 * there still fails. `skipUnder` drops a root from a measure that cannot apply there.
 */
export const TARGETS = {
  radius: {
    title: 'radius steps',
    // `none` stays on this list so a `rounded-none` is not counted twice. It gates on its own as
    // `nullRadius`, which is a different defect from picking a step off the scale.
    allowed: ['md', 'lg', 'full', 'none'],
    histogram: true,
  },
  bareRadius: { title: "bare 'rounded'", limit: 0, listed: true },
  nullRadius: { title: "redundant 'rounded-none'", limit: 0, listed: true },
  buttonRadius: {
    title: 'radius on <Button>',
    limit: 0,
    // In the primitives package a radius beside a <Button> is the control defining its own corner,
    // not an app overriding it.
    skipUnder: [UI_PACKAGE],
  },
  compactVariant: { title: "'compact:' utilities", limit: 0 },
  densityVars: { title: 'density variables', histogram: true, histogramOnly: true },
  barHeights: { title: 'bar heights', allowed: [BAR_HEIGHT], histogram: true },
  dividerOpacity: { title: 'border-border/N dividers', limit: 0, listed: true },
  arbitraryText: { title: 'arbitrary text sizes', limit: 0, histogram: true, listed: true },
  shadow: {
    title: 'elevation steps',
    allowed: ['shadow-md', 'shadow-xl', 'shadow-none'],
    histogram: true,
  },
  rawButtons: {
    title: 'raw <button> elements',
    allowListed: true,
    listed: true,
    // A primitive is the button, so the raw element has to be written somewhere in packages/ui.
    skipUnder: [UI_PACKAGE],
  },
  hoverFills: {
    title: 'hover fills',
    histogram: true,
    // Mostly reported, not gated: the script cannot tell a list row, which owes `bg-row-hover`,
    // from a chip or a toggled control, which does not. One slice is unambiguous and does gate.
    histogramOnly: true,
    gates: 'an opacity modifier on bg-row-hover / bg-row-selected, whose alpha is the design',
  },
  paletteLeaks: { title: 'raw palette colours', limit: 0, listed: true },
  truncationRecovery: {
    title: 'truncation with no title on the row',
    limit: 0,
    listed: true,
    allowListed: true,
    // A primitive cannot know whether the string it renders is a label or a value; the consumer
    // that knows sets the title.
    skipUnder: [UI_PACKAGE],
  },
}

/** Measures read back out of the radius histogram rather than collected in a bucket of their own. */
const DERIVED = { bareRadius: bareRadiusHits, nullRadius: nullRadiusHits }
const MEASURES = Object.keys(TARGETS).filter((measure) => !(measure in DERIVED))
const ALL_MEASURES = MEASURES.concat(Object.keys(DERIVED))

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
// Any unit, not just px and rem: `text-[0.9em]` is as much an off-scale size as `text-[11px]`.
// A leading digit is what separates a size from `text-[var(--x)]` or `text-[#abc]`, which are
// colours and belong to the palette measure.
const ARBITRARY_TEXT = /^text-\[(?:length:)?\d*\.?\d+[a-z%]*\]$/i
// The row fills carry their own alpha (see the row tokens in globals.css), so an opacity modifier
// on one always fights the design rather than expressing it.
const ROW_FILL_OPACITY = /^(?:hover:)?bg-row-(?:hover|selected)\/\d+$/
const DIVIDER_OPACITY = /^border(?:-(?:[trbl]|x|y|s|e))?-border\/\d+$/
const HEIGHT_TOKEN = /^h-(?:\d+(?:\.\d+)?|px|\[[^\]]*\]|\([^)]*\))$/
const TRUNCATION = /^(?:truncate|line-clamp-\d+)$/
const SOURCE_FILE = /\.tsx?$/
const TEST_FILE = /(?:^|\/)tests?\/|\.(?:test|browser|test-d)\.tsx?$/

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
  const markup = file.endsWith('.tsx')
  for (const entry of strings) {
    if (markup) recordColorLiterals(census, file, entry, lineOfEntry(entry, lineAt))
    recordString(census, file, entry, lineAt, groups)
  }
  recordBarHeights(census, groups)
  return census
}

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(filename)
    // `.ts` too: a module that exports class-name strings is a design decision like any other.
    return SOURCE_FILE.test(entry.name) ? [filename] : []
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
    // A truncating class recovers through a title on its own element or on any element that
    // encloses it in this file. What a parent component renders around it is out of view here.
    titled: element !== null && (hasTitle(element) || enclosingElements(ancestors).some(hasTitle)),
  })
}

function hasTitle(opening) {
  return opening.attributes.some(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === 'title',
  )
}

// The stack holds the JSXElement of every enclosing tag; its opening element carries the props.
function enclosingElements(ancestors) {
  return ancestors.filter((node) => node.type === 'JSXElement').map((node) => node.openingElement)
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

function lineOfEntry(entry, lineAt) {
  return (index) => lineAt(entry.start) + newlinesBefore(entry.value, index)
}

function recordString(census, file, entry, lineAt, groups) {
  const lineOf = lineOfEntry(entry, lineAt)
  if (!looksLikeClassString(entry.value)) return
  recordDensityVars(census, file, entry, lineOf)
  const group = groupFor(groups, entry)
  for (const token of classTokens(entry.value))
    recordToken(census, file, entry, token, lineOf, group)
}

// Only markup is scanned for these. A hex in a component is a styling decision that owed a token;
// in a plain `.ts` module it is data — a CodeMirror theme, a canvas fillStyle — with no token form.
// A palette *class* still counts in either kind of file.
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
  // Only an unconditional class describes this element. Behind a variant it is an override for a
  // breakpoint, a state or — with `[&_input]:` — a descendant, and none of those make it a bar.
  if (token.variants.length === 0) recordBarShape(group, hit, token.base)
  if (token.variants.includes('compact'))
    census.hits.compactVariant.push({ ...hit, value: token.raw })
  if (DIVIDER_OPACITY.test(token.base)) census.hits.dividerOpacity.push(hit)
  if (ARBITRARY_TEXT.test(token.base)) census.hits.arbitraryText.push(hit)
  if (PALETTE_CLASS.test(token.base)) census.hits.paletteLeaks.push(hit)
  if (TRUNCATION.test(token.base) && !entry.titled) census.hits.truncationRecovery.push(hit)
  recordHoverFill(census, token, hit)
  recordShadow(census, token, hit)
  recordRadius(census, entry, token, hit)
}

function recordBarShape(group, hit, base) {
  group.bases.add(base)
  if (HEIGHT_TOKEN.test(base)) group.heights.push(hit)
}

// A hovered fill of any kind is histogram material; a row token wearing an opacity modifier is
// recorded whatever variant it carries, because that is the slice this measure gates.
function recordHoverFill(census, token, hit) {
  const hovers = token.variants.includes('hover')
  const fill = hovers && token.base.startsWith('bg-')
  if (!fill && !ROW_FILL_OPACITY.test(token.base)) return
  census.hits.hoverFills.push({ ...hit, value: hovers ? `hover:${token.base}` : token.base })
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

// A bar carries a top or bottom rule and lays its cells out along one line: `items-center` for a
// flex bar, `grid` for the titlebar, which sizes its cells with grid columns instead. Requiring a
// fixed height as well is what keeps a bordered content block out: those grow with their content.
function isBar(bases) {
  if (!bases.has('border-b') && !bases.has('border-t')) return false
  return bases.has('items-center') || bases.has('grid')
}

// Every explicit `h-(--bar-height)` counts wherever it sits, so the token shows up in the
// histogram as the single settled value.
function recordBarHeights(census, groups) {
  const seen = new Set()
  for (const group of groups.values()) {
    const bar = isBar(group.bases)
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

// No radius class already means no radius, so a `rounded-none` only ever cancels a corner a
// primitive owns. Where that is deliberate it needs an allow-list entry saying so.
function nullRadiusHits(census) {
  return census.hits.radius.filter((hit) => radiusInfo(hit.value).step === 'none')
}

function rowFillOpacityHits(census) {
  return census.hits.hoverFills.filter((hit) => ROW_FILL_OPACITY.test(hit.value))
}

/** Drops the hits a measure cannot judge in the root they came from. */
function scoped(measure, hits) {
  const skip = TARGETS[measure].skipUnder
  if (skip === undefined) return hits
  return hits.filter((hit) => !skip.some((prefix) => hit.file.startsWith(prefix)))
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
  const gate = (measure, hits) => unallowed(scoped(measure, hits), allow)
  const offenders = {
    radius: gate('radius', offScaleRadius(census)),
    bareRadius: gate('bareRadius', bareRadiusHits(census)),
    nullRadius: gate('nullRadius', nullRadiusHits(census)),
    buttonRadius: gate('buttonRadius', census.hits.buttonRadius),
    compactVariant: gate('compactVariant', census.hits.compactVariant),
    barHeights: gate('barHeights', offTarget(census.hits.barHeights, TARGETS.barHeights.allowed)),
    dividerOpacity: gate('dividerOpacity', census.hits.dividerOpacity),
    arbitraryText: gate('arbitraryText', census.hits.arbitraryText),
    shadow: gate('shadow', offTarget(census.hits.shadow, TARGETS.shadow.allowed)),
    rawButtons: gate('rawButtons', census.hits.rawButtons),
    hoverFills: gate('hoverFills', rowFillOpacityHits(census)),
    paletteLeaks: gate('paletteLeaks', census.hits.paletteLeaks),
    truncationRecovery: gate('truncationRecovery', census.hits.truncationRecovery),
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

function toJson(census, result, roots) {
  const measures = {}
  for (const measure of MEASURES)
    measures[measure] = Object.fromEntries(histogram(census.hits[measure]))
  return {
    roots,
    files: census.files,
    measures,
    totals: Object.fromEntries(
      ALL_MEASURES.map((measure) => [measure, hitsFor(census, measure).length]),
    ),
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
  const rows = ALL_MEASURES.map((measure) => [
    TARGETS[measure].title,
    hitsFor(census, measure).length,
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

function formatRoots(roots) {
  return roots.map(({ root, files }) => `${root} ${files}`).join(', ')
}

function formatReport(census, result, roots) {
  const listed = ALL_MEASURES.filter((measure) => TARGETS[measure].listed)
  return [
    `Web design census — ${census.files} .ts/.tsx files, tests excluded: ${formatRoots(roots)}`,
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
  const derived = DERIVED[measure]
  return derived === undefined ? census.hits[measure] : derived(census)
}

function walkRoots(roots) {
  return roots.map((root) => {
    const census = censusTree(root)
    return { root: posix(path.relative(REPOSITORY, root)) || root, files: census.files, census }
  })
}

function main() {
  const { values } = parseArgs({
    options: {
      allow: { type: 'string', default: DEFAULT_ALLOW },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      // Repeatable, and any `--root` replaces the default pair rather than adding to it.
      root: { type: 'string', multiple: true },
    },
  })
  const requested = values.root ?? []
  const roots = requested.length === 0 ? DEFAULT_ROOTS : requested.map((root) => path.resolve(root))
  const walked = walkRoots(roots)
  const census = mergeCensus(walked.map((entry) => entry.census))
  const allowEntries = readAllowList(path.resolve(values.allow))
  const result = evaluate(census, allowEntries)
  const summary = walked.map(({ root, files }) => ({ root, files }))
  const output = values.json
    ? `${JSON.stringify(toJson(census, result, summary), null, 2)}\n`
    : formatReport(census, result, summary)
  process.stdout.write(output)
  process.exitCode = values.check && !result.passed ? 1 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
